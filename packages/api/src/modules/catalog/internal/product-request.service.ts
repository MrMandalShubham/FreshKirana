import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, type SQL } from 'drizzle-orm';
import { DATABASE } from '../../../db/db.module';
import type { Database } from '../../../db';
import { productRequest } from '../schema';
import { CatalogService } from './catalog.service';
import { DuplicateDetector } from './duplicate-detector';
import type { CreateProductRequestDto } from './catalog.dto';

export const ProductRequestStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  DUPLICATE: 'DUPLICATE',
} as const;

/**
 * The product-request queue (spec §1.9.1).
 *
 * Decision D1 stops branches creating master products. This is how a branch
 * still sells a regional brand nobody has catalogued: they describe it, an
 * admin creates the canonical product, and their offer attaches.
 */
@Injectable()
export class ProductRequestService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly catalog: CatalogService,
    private readonly duplicates: DuplicateDetector,
  ) {}

  /**
   * Submits a request, checking for an existing product first.
   *
   * A branch scanning a barcode we already have should be told so immediately
   * rather than waiting on a queue — most requests are this case, and turning
   * them into admin work would drown the queue that matters.
   */
  async submit(branchId: string, accountId: string | null, dto: CreateProductRequestDto) {
    const candidates = await this.duplicates.findCandidates({
      name: dto.proposedName,
      eanBarcode: dto.proposedEanBarcode,
      netQuantity: dto.proposedNetQuantity ?? null,
      uom: dto.proposedUom ?? null,
    });

    const exactMatch = candidates.find((c) => c.reason === 'EAN_MATCH');
    if (exactMatch) {
      throw new ConflictException({
        message: 'This product already exists — create an offer against it instead',
        masterProductId: exactMatch.id,
        name: exactMatch.name,
      });
    }

    const rows = await this.db
      .insert(productRequest)
      .values({
        branchId,
        requestedByAccountId: accountId,
        eanBarcode: dto.proposedEanBarcode ?? null,
        proposedName: dto.proposedName,
        proposedBrand: dto.proposedBrand ?? null,
        proposedNetQuantity: dto.proposedNetQuantity ?? null,
        proposedUom: dto.proposedUom ?? null,
        categoryHint: dto.categoryHint ?? null,
        notes: dto.notes ?? null,
        images: dto.images ?? [],
        desiredMrpPaise: dto.desiredMrpPaise ?? null,
        desiredSellingPricePaise: dto.desiredSellingPricePaise ?? null,
        desiredStockOnHand: dto.desiredStockOnHand ?? null,
        status: ProductRequestStatus.PENDING,
      })
      .returning();

    // Weaker matches are advisory: returned so the branch can self-serve, but
    // not blocking, because a same-name different-product is real.
    return { request: rows[0], possibleMatches: candidates };
  }

  async findById(id: string) {
    const rows = await this.db
      .select()
      .from(productRequest)
      .where(eq(productRequest.id, id))
      .limit(1);

    const found = rows[0];
    if (!found) throw new NotFoundException(`Product request ${id} not found`);
    return found;
  }

  async listForVendor(branchId: string, status?: string) {
    const filters: SQL[] = [eq(productRequest.branchId, branchId)];
    if (status) filters.push(eq(productRequest.status, status));

    return this.db
      .select()
      .from(productRequest)
      .where(and(...filters))
      .orderBy(asc(productRequest.createdAt));
  }

  /** The admin queue: oldest pending first, so nothing waits indefinitely. */
  async listQueue(status: string = ProductRequestStatus.PENDING) {
    return this.db
      .select()
      .from(productRequest)
      .where(eq(productRequest.status, status))
      .orderBy(asc(productRequest.createdAt));
  }

  /**
   * Approves a request by creating the master product it describes.
   *
   * Returns the created product so the caller can attach the branch's offer —
   * that orchestration lives in the admin module, because catalog must not
   * depend on offer (which already depends on catalog).
   */
  async approve(
    id: string,
    reviewerAccountId: string,
    input: {
      slug: string;
      name: string;
      categoryId: string;
      netQuantity: number;
      uom: string;
      hsnCode: string;
      gstRateBp: number;
      eanBarcode?: string;
      isPrepackaged?: boolean;
      manufacturerPacker?: string;
      countryOfOrigin?: string;
      consumerCareContact?: string;
      activate?: boolean;
    },
  ) {
    const request = await this.findById(id);
    this.assertPending(request.status);

    const product = await this.catalog.createProduct({
      slug: input.slug,
      name: input.name,
      categoryId: input.categoryId,
      netQuantity: input.netQuantity,
      uom: input.uom as never,
      hsnCode: input.hsnCode,
      gstRateBp: input.gstRateBp,
      eanBarcode: input.eanBarcode ?? request.eanBarcode ?? undefined,
      isPrepackaged: input.isPrepackaged ?? true,
      manufacturerPacker: input.manufacturerPacker,
      countryOfOrigin: input.countryOfOrigin,
      consumerCareContact: input.consumerCareContact,
      status: input.activate ? 'ACTIVE' : 'DRAFT',
    });

    if (!product) throw new BadRequestException('Product creation returned no row');

    const rows = await this.db
      .update(productRequest)
      .set({
        status: ProductRequestStatus.APPROVED,
        resolvedMasterProductId: product.id,
        reviewedByAccountId: reviewerAccountId,
        reviewedAt: new Date(),
      })
      .where(eq(productRequest.id, id))
      .returning();

    return { request: rows[0], product };
  }

  /** Rejects outright, or points the branch at the product it duplicates. */
  async reject(
    id: string,
    reviewerAccountId: string,
    input: { reviewerNotes: string; duplicateOfMasterProductId?: string },
  ) {
    const request = await this.findById(id);
    this.assertPending(request.status);

    if (input.duplicateOfMasterProductId) {
      // Confirms the product exists before pointing the branch at it.
      await this.catalog.getProduct(input.duplicateOfMasterProductId);
    }

    const rows = await this.db
      .update(productRequest)
      .set({
        status: input.duplicateOfMasterProductId
          ? ProductRequestStatus.DUPLICATE
          : ProductRequestStatus.REJECTED,
        resolvedMasterProductId: input.duplicateOfMasterProductId ?? null,
        reviewerNotes: input.reviewerNotes,
        reviewedByAccountId: reviewerAccountId,
        reviewedAt: new Date(),
      })
      .where(eq(productRequest.id, id))
      .returning();

    return rows[0];
  }

  private assertPending(status: string): void {
    if (status !== ProductRequestStatus.PENDING) {
      throw new BadRequestException(
        `Request is already ${status} — reopening a resolved request would lose the audit trail`,
      );
    }
  }
}
