import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import {
  CORRELATION_HEADER,
  resolveCorrelationId,
  runWithContext,
  setContextRoute,
} from './correlation';
import { logger } from './logger';
import { httpRequestDuration, httpRequestsTotal } from './metrics';

/**
 * Opens the request context, then logs and measures the request on completion.
 *
 * Runs as middleware rather than an interceptor so the context exists before
 * guards execute — otherwise a 401 rejected by AuthGuard would have no
 * correlation id, and unauthorised traffic is exactly what you most want to
 * trace (§2.16, §3.3).
 */
@Injectable()
export class ObservabilityMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const correlationId = resolveCorrelationId(req.headers[CORRELATION_HEADER]);
    res.setHeader(CORRELATION_HEADER, correlationId);

    runWithContext({ correlationId }, () => {
      const startedAt = process.hrtime.bigint();

      res.on('finish', () => {
        // Prefer the matched route pattern; falling back to the raw path would
        // put unbounded cardinality into the metric labels.
        const route = routePatternOf(req);
        setContextRoute(route);

        const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
        const labels = {
          method: req.method,
          route,
          status: String(res.statusCode),
        };

        httpRequestsTotal.inc(labels);
        httpRequestDuration.observe(labels, seconds);

        const level =
          res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
        logger[level](
          {
            method: req.method,
            route,
            status: res.statusCode,
            durationMs: Math.round(seconds * 1000),
          },
          'request completed',
        );
      });

      next();
    });
  }
}

interface RouteCarrier {
  route?: { path?: string };
  baseUrl?: string;
}

function routePatternOf(req: Request): string {
  const carrier = req as unknown as RouteCarrier;
  const pattern = carrier.route?.path;
  if (!pattern) return 'unmatched';
  const base = carrier.baseUrl ?? '';
  return `${base}${pattern}` || '/';
}
