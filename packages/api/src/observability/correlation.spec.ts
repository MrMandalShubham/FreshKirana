import { describe, expect, it } from 'vitest';
import {
  getContext,
  getCorrelationId,
  resolveCorrelationId,
  runWithContext,
  setContextAccountId,
} from './correlation';

describe('request context', () => {
  it('is absent outside a request', () => {
    expect(getContext()).toBeUndefined();
  });

  it('is available inside the scope', () => {
    runWithContext({ correlationId: 'abc-123' }, () => {
      expect(getCorrelationId()).toBe('abc-123');
    });
  });

  it('survives await boundaries', async () => {
    await runWithContext({ correlationId: 'across-await' }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(getCorrelationId()).toBe('across-await');
    });
  });

  it('keeps concurrent requests isolated', async () => {
    const seen: string[] = [];
    await Promise.all([
      runWithContext({ correlationId: 'req-a' }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        seen.push(getCorrelationId() ?? 'missing');
      }),
      runWithContext({ correlationId: 'req-b' }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        seen.push(getCorrelationId() ?? 'missing');
      }),
    ]);
    expect(seen.sort()).toEqual(['req-a', 'req-b']);
  });

  it('records the account id once the guard resolves it', () => {
    runWithContext({ correlationId: 'x' }, () => {
      setContextAccountId('acc-1');
      expect(getContext()?.accountId).toBe('acc-1');
    });
  });
});

describe('resolveCorrelationId', () => {
  it('reuses a well-formed inbound id so traces span services', () => {
    expect(resolveCorrelationId('req-abc-123')).toBe('req-abc-123');
  });

  it('mints one when absent', () => {
    expect(resolveCorrelationId(undefined)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rejects ids that could inject into logs', () => {
    // Newlines would let an untrusted client forge log lines.
    const injected = 'abcdefgh\n{"level":"error","msg":"fake"}';
    expect(resolveCorrelationId(injected)).not.toBe(injected);
  });

  it('rejects over-long and too-short ids', () => {
    expect(resolveCorrelationId('short')).not.toBe('short');
    expect(resolveCorrelationId('a'.repeat(200))).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('takes the first value when the header repeats', () => {
    expect(resolveCorrelationId(['first-value-here', 'second'])).toBe('first-value-here');
  });
});
