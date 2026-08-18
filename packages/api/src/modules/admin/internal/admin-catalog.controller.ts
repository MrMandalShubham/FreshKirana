import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { type Principal, Role } from '@freshkirana/contracts';
import { CurrentUser, Roles } from '../../identity/contracts';
import {
  ApproveProductRequestDto,
  CatalogImportService,
  ImportCatalogDto,
  ProductRequestService,
  RejectProductRequestDto,
} from '../../catalog/contracts';
import { OfferService } from '../../offer/contracts';

/**
 * Backoffice catalog operations (spec §2.2 "admin: orchestration over the
 * other modules", §1.5.4).
 *
 * Approving a request has to create a master product *and* attach the
 * requesting vendor's offer. Catalog cannot do that: offer already depends on
 * catalog, so catalog calling offer would close a dependency cycle that
 * dependency-cruiser rejects. Orchestration across modules is exactly what this
 * module is for.
 */
@Roles(Role.ADMIN, Role.OPS)
@Controller('admin/catalog')
export class AdminCatalogController {
  constructor(
    private readonly requests: ProductRequestService,
    private readonly offers: OfferService,
    private readonly importer: CatalogImportService,
  ) {}

  @Get('product-requests')
  queue(@Query('status') status?: string) {
    return this.requests.listQueue(status);
  }

  @Get('product-requests/:id')
  get(@Param('id') id: string) {
    return this.requests.findById(id);
  }

  /**
   * Creates the master product and, where the vendor supplied a price, their
   * offer for it in one step.
   *
   * The offer is best-effort: if it fails (say the vendor was suspended while
   * the request sat in the queue) the product still exists and the approval
   * stands. Losing the product because the offer failed would be the worse
   * outcome — the catalog work is the scarce part.
   */
  @Post('product-requests/:id/approve')
  async approve(
    @Param('id') id: string,
    @Body() dto: ApproveProductRequestDto,
    @CurrentUser() principal: Principal,
  ) {
    const { request, product } = await this.requests.approve(
      id,
      principal.accountId,
      dto,
    );

    if (!product || !request) {
      return { request, product, offer: null };
    }

    if (request.desiredMrpPaise == null || request.desiredSellingPricePaise == null) {
      return {
        request,
        product,
        offer: null,
        offerNote: 'No price supplied at request time',
      };
    }

    try {
      const offer = await this.offers.create(request.vendorId, {
        masterProductId: product.id,
        mrpPaise: request.desiredMrpPaise,
        sellingPricePaise: request.desiredSellingPricePaise,
        stockOnHand: request.desiredStockOnHand ?? 0,
      });
      return { request, product, offer };
    } catch (error) {
      return {
        request,
        product,
        offer: null,
        offerNote: `Product created; offer failed: ${(error as { message?: string }).message ?? 'unknown'}`,
      };
    }
  }

  @Post('product-requests/:id/reject')
  reject(
    @Param('id') id: string,
    @Body() dto: RejectProductRequestDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.requests.reject(id, principal.accountId, dto);
  }

  /** Bulk import (readiness item C1). Idempotent by slug. */
  @Post('import')
  import(@Body() dto: ImportCatalogDto) {
    return this.importer.importFromCsv(dto.csv);
  }
}
