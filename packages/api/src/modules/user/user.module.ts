import { Module } from '@nestjs/common';

/**
 * User module - Customer profiles, addresses, preferences, consent records.
 *
 * Owns the `user` PostgreSQL schema. Other modules may import only from
 * `./contracts`; `./schema` and `./internal` are private (spec 2.1.1, rule R2).
 */
@Module({})
export class UserModule {}
