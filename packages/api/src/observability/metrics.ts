import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

export const registry = new Registry();

collectDefaultMetrics({ register: registry });

/**
 * RED metrics per route (spec §2.16).
 *
 * Labelled by *route pattern*, never by raw path: `/orders/:id` keeps
 * cardinality bounded, whereas `/orders/<uuid>` would mint a new time series
 * per order and eventually take out the metrics backend.
 */
export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'HTTP requests by route, method and status',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [registry],
});

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration',
  labelNames: ['method', 'route', 'status'] as const,
  // Bucketed around the §1.4.2 SLOs: 200ms search, 400ms checkout, 800ms pay.
  buckets: [0.01, 0.05, 0.1, 0.2, 0.3, 0.5, 0.8, 1, 2, 5],
  registers: [registry],
});

/** Business metrics (§2.16). Extended as the parts that emit them land. */
export const analyticsEventsIngested = new Counter({
  name: 'analytics_events_ingested_total',
  help: 'Analytics events accepted at ingest, by event name',
  labelNames: ['event'] as const,
  registers: [registry],
});

export const analyticsEventsRejected = new Counter({
  name: 'analytics_events_rejected_total',
  help: 'Analytics events rejected at ingest, by reason',
  labelNames: ['reason'] as const,
  registers: [registry],
});
