import { Module } from '@nestjs/common';

/**
 * Identity module - Auth, OTP, sessions, JWT and refresh tokens, roles, permissions.
 *
 * Owns the `identity` PostgreSQL schema. Other modules may import only from
 * `./contracts`; `./schema` and `./internal` are private (spec 2.1.1, rule R2).
 */
@Module({})
export class IdentityModule {}
