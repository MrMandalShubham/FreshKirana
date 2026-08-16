import { describe, expect, it } from 'vitest';
import {
  ANALYTICS_EVENTS,
  AnalyticsEvent,
  findForbiddenProperties,
  isAnalyticsEvent,
} from './analytics';

describe('event catalogue', () => {
  it('declares the §5.1 funnel events', () => {
    expect(isAnalyticsEvent('order_placed')).toBe(true);
    expect(isAnalyticsEvent('add_to_cart')).toBe(true);
    expect(isAnalyticsEvent('weight_recorded')).toBe(true);
  });

  it('rejects undeclared events', () => {
    expect(isAnalyticsEvent('someone_invented_this')).toBe(false);
  });

  it('has no duplicate names', () => {
    expect(new Set(ANALYTICS_EVENTS).size).toBe(ANALYTICS_EVENTS.length);
  });

  it('covers the substitution branch that measures §1.3.3', () => {
    expect(ANALYTICS_EVENTS).toContain(AnalyticsEvent.SUBSTITUTION_ACCEPTED);
    expect(ANALYTICS_EVENTS).toContain(AnalyticsEvent.SUBSTITUTION_REJECTED);
  });
});

describe('findForbiddenProperties - §5.3 governance', () => {
  it('passes clean analytics properties', () => {
    expect(
      findForbiddenProperties({
        source: 'usual_basket',
        itemCount: 12,
        valuePaise: 60000,
      }),
    ).toEqual([]);
  });

  it('catches personal data at the top level', () => {
    expect(findForbiddenProperties({ phone: '+919000000001' })).toEqual(['phone']);
  });

  it('catches it nested', () => {
    expect(findForbiddenProperties({ customer: { email: 'a@b.com' } })).toEqual([
      'customer.email',
    ]);
  });

  it('is insensitive to case and separators', () => {
    expect(findForbiddenProperties({ Phone_Number: 'x' })).toEqual(['Phone_Number']);
    expect(findForbiddenProperties({ 'card-number': 'x' })).toEqual(['card-number']);
    expect(findForbiddenProperties({ accessToken: 'x' })).toEqual(['accessToken']);
  });

  it('catches location, which identifies a household', () => {
    expect(findForbiddenProperties({ lat: 12.9, lng: 77.6 }).sort()).toEqual([
      'lat',
      'lng',
    ]);
  });

  it('reports every offender, not just the first', () => {
    const found = findForbiddenProperties({
      phone: 'x',
      ok: 1,
      nested: { vpa: 'y' },
    });
    expect(found.sort()).toEqual(['nested.vpa', 'phone']);
  });
});
