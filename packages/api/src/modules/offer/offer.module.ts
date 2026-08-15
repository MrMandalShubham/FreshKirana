import { Module } from '@nestjs/common';

/**
 * Offer module - Vendor offers - price, stock, batch and expiry, per-slot availability.
 *
 * Owns the `offer` PostgreSQL schema. Other modules may import only from
 * `./contracts`; `./schema` and `./internal` are private (spec 2.1.1, rule R2).
 */
@Module({})
export class OfferModule {}
