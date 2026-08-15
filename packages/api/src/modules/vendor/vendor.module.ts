import { Module } from '@nestjs/common';

/**
 * Vendor module - Vendor accounts, KYC/FSSAI/GST, store config, staff, SLA scores.
 *
 * Owns the `vendor` PostgreSQL schema. Other modules may import only from
 * `./contracts`; `./schema` and `./internal` are private (spec 2.1.1, rule R2).
 */
@Module({})
export class VendorModule {}
