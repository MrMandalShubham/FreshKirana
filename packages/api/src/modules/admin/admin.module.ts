import { Module } from '@nestjs/common';

/**
 * Admin module - Backoffice orchestration over the other modules.
 *
 * Owns the `admin` PostgreSQL schema. Other modules may import only from
 * `./contracts`; `./schema` and `./internal` are private (spec 2.1.1, rule R2).
 */
@Module({})
export class AdminModule {}
