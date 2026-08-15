import { Module } from '@nestjs/common';

/**
 * Support module - Tickets, disputes, refunds workflow, grievance tracking.
 *
 * Owns the `support` PostgreSQL schema. Other modules may import only from
 * `./contracts`; `./schema` and `./internal` are private (spec 2.1.1, rule R2).
 */
@Module({})
export class SupportModule {}
