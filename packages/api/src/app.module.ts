import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';

/**
 * Application root.
 *
 * From P0.2 onward this composes the bounded-context modules of spec §2.2, each
 * owning its own schema and exposing a published interface. Module boundaries
 * are enforced in CI - see §2.1.1 and standing rule R2.
 */
@Module({
  controllers: [HealthController],
})
export class AppModule {}
