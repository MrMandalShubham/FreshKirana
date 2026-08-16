import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { ObservabilityMiddleware } from './observability.middleware';

/**
 * Cross-cutting observability (spec §2.16): correlation context, structured
 * logging with PII redaction, and Prometheus metrics.
 *
 * Platform infrastructure rather than a bounded context, so it lives outside
 * `src/modules/`.
 */
@Module({
  controllers: [MetricsController],
})
export class ObservabilityModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ObservabilityMiddleware).forRoutes('*');
  }
}
