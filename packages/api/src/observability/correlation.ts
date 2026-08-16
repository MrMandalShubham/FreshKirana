import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export interface RequestContext {
  /** Ties every log line, metric and outbox event from one request together. */
  correlationId: string;
  accountId?: string;
  route?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Request-scoped context via AsyncLocalStorage.
 *
 * The alternative — threading a correlation id through every function
 * signature — makes every call site care about observability. This keeps it
 * ambient, and it survives `await` boundaries, so a log line written deep in a
 * repository still carries the id of the request that caused it (§2.16).
 */
export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getContext(): RequestContext | undefined {
  return storage.getStore();
}

export function getCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}

/** Records the authenticated principal once the guard has resolved it. */
export function setContextAccountId(accountId: string): void {
  const context = storage.getStore();
  if (context) context.accountId = accountId;
}

export function setContextRoute(route: string): void {
  const context = storage.getStore();
  if (context) context.route = route;
}

export const CORRELATION_HEADER = 'x-correlation-id';

/**
 * Reuses an inbound correlation id when it looks safe, otherwise mints one.
 *
 * Accepting a caller-supplied id lets a trace span the PWA, the API and later
 * the outbox. It is echoed into logs and response headers, so it is length- and
 * charset-limited to stop log injection from an untrusted client.
 */
export function resolveCorrelationId(inbound: unknown): string {
  const value = Array.isArray(inbound) ? inbound[0] : inbound;
  if (typeof value === 'string' && /^[A-Za-z0-9._-]{8,128}$/.test(value)) {
    return value;
  }
  return randomUUID();
}
