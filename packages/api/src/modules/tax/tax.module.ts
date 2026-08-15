import { Module } from '@nestjs/common';

/**
 * Tax module - GST computation, HSN resolution, invoice generation, TCS and TDS.
 *
 * Owns the `tax` PostgreSQL schema. Other modules may import only from
 * `./contracts`; `./schema` and `./internal` are private (spec 2.1.1, rule R2).
 */
@Module({})
export class TaxModule {}
