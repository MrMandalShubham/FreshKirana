import { Module } from '@nestjs/common';
import { DbModule } from './db/db.module';
import { HealthController } from './health/health.controller';
import { IdentityModule } from './modules/identity/identity.module';

/**
 * Application root.
 *
 * Composes the bounded-context modules of spec §2.2. Each owns its own
 * PostgreSQL schema and exposes a published interface in its `contracts.ts`;
 * boundaries are enforced in CI (§2.1.1, rule R2), not by convention.
 *
 * Module stubs exist under `src/modules/` and are registered here as their
 * implementing part lands.
 */
@Module({
  imports: [DbModule, IdentityModule],
  controllers: [HealthController],
})
export class AppModule {}
