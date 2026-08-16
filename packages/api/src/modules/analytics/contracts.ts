/**
 * Public interface of the analytics module.
 *
 * The ONLY file other modules may import from. Every export here is a
 * deliberate widening of this module's public surface (spec §2.1.1).
 *
 * Other modules emit events through `AnalyticsService.emit()`, which never
 * throws — a failed analytics write must never fail the business operation that
 * produced it.
 */

export { AnalyticsService, type TrackInput } from './internal/analytics.service';

export { AnalyticsEvent, type Platform } from '@freshkirana/contracts';
