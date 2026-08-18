import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ScopeType } from '@freshkirana/contracts';
import { and, asc, eq, type SQL } from 'drizzle-orm';
import { DATABASE } from '../../../db/db.module';
import type { Database } from '../../../db';
import { AccountRepository } from '../../identity/contracts';
import { vendor } from '../schema';
import {
  type AddVendorStaffDto,
  type CreateVendorDto,
  type UpdateVendorDto,
  VendorStatus,
} from './vendor.dto';

const PG_UNIQUE_VIOLATION = '23505';
const PG_CHECK_VIOLATION = '23514';

function pgCode(error: unknown): string | undefined {
  return (error as { code?: string } | null)?.code;
}

function pgConstraint(error: unknown): string | undefined {
  return (error as { constraint?: string } | null)?.constraint;
}

@Injectable()
export class VendorService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly accounts: AccountRepository,
  ) {}

  async create(dto: CreateVendorDto) {
    try {
      const rows = await this.db
        .insert(vendor)
        .values({
          slug: dto.slug,
          legalName: dto.legalName,
          displayName: dto.displayName,
          phone: dto.phone,
          email: dto.email ?? null,
          addressLine: dto.addressLine,
          city: dto.city,
          pincode: dto.pincode,
          gstRegistrationType: dto.gstRegistrationType ?? 'UNREGISTERED',
          gstin: dto.gstin ?? null,
          fssaiLicenceNo: dto.fssaiLicenceNo ?? null,
          fssaiExpiryDate: dto.fssaiExpiryDate ?? null,
          defaultInventoryMode: dto.defaultInventoryMode ?? 'TOGGLE',
          storeConfig: dto.storeConfig ?? {},
          // Vendors are never born ACTIVE: approval is a deliberate admin act
          // (§1.5.4), and going live requires an FSSAI licence.
          status: VendorStatus.PENDING,
        })
        .returning();
      return rows[0];
    } catch (error) {
      throw this.translateWriteError(error, dto.slug);
    }
  }

  async findById(id: string) {
    const rows = await this.db.select().from(vendor).where(eq(vendor.id, id)).limit(1);
    const found = rows[0];
    if (!found) throw new NotFoundException(`Vendor ${id} not found`);
    return found;
  }

  async list(filters: { status?: string; city?: string }) {
    const where: SQL[] = [];
    if (filters.status) where.push(eq(vendor.status, filters.status));
    if (filters.city) where.push(eq(vendor.city, filters.city));

    return this.db
      .select()
      .from(vendor)
      .where(where.length > 0 ? and(...where) : undefined)
      .orderBy(asc(vendor.displayName));
  }

  async update(id: string, dto: UpdateVendorDto) {
    const existing = await this.findById(id);

    // Checked here for a clear message; the database CHECK is the guarantee.
    const merged = { ...existing, ...dto };
    if (merged.status === VendorStatus.ACTIVE && !merged.fssaiLicenceNo?.trim()) {
      throw new BadRequestException(
        'A vendor cannot be ACTIVE without an FSSAI licence number (§3.7.3)',
      );
    }
    if (merged.gstRegistrationType === 'REGISTERED' && !merged.gstin?.trim()) {
      throw new BadRequestException(
        'A GST-registered vendor must have a GSTIN — the invoice is issued under it (§3.7.1)',
      );
    }

    try {
      const rows = await this.db
        .update(vendor)
        .set({ ...dto, updatedAt: new Date() })
        .where(eq(vendor.id, id))
        .returning();
      return rows[0];
    } catch (error) {
      throw this.translateWriteError(error, existing.slug);
    }
  }

  /**
   * Adds staff by granting a **vendor-scoped** role (§3.2).
   *
   * Membership is recorded in the identity module rather than duplicated here,
   * so exactly one place answers "who may act as this vendor". Reached through
   * identity's contracts — never by touching its schema.
   */
  async addStaff(vendorId: string, dto: AddVendorStaffDto) {
    await this.findById(vendorId);

    const existing = await this.accounts.findByPhone(dto.phone);
    const accountId =
      existing?.id ??
      (
        await this.accounts.createAccount({
          phone: dto.phone,
          displayName: dto.displayName,
        })
      ).id;

    await this.accounts.grantRole({
      accountId,
      role: dto.role,
      scopeType: ScopeType.VENDOR,
      scopeId: vendorId,
    });

    return { accountId, vendorId, role: dto.role };
  }

  private translateWriteError(error: unknown, slug?: string): unknown {
    if (pgCode(error) === PG_UNIQUE_VIOLATION) {
      return new ConflictException(`Vendor slug "${slug}" already exists`);
    }

    if (pgCode(error) === PG_CHECK_VIOLATION) {
      switch (pgConstraint(error)) {
        case 'vendor_fssai_required_when_active':
          return new BadRequestException(
            'A vendor cannot be ACTIVE without an FSSAI licence number (§3.7.3)',
          );
        case 'vendor_gstin_present_when_registered':
          return new BadRequestException(
            'A GST-registered vendor must have a GSTIN (§3.7.1)',
          );
        case 'vendor_gstin_shape':
          return new BadRequestException('GSTIN is not a valid 15-character GSTIN');
        case 'vendor_pincode_shape':
          return new BadRequestException('pincode must be 6 digits and not start with 0');
        default:
          return new BadRequestException(
            `Vendor violates constraint ${pgConstraint(error)}`,
          );
      }
    }

    return error;
  }
}
