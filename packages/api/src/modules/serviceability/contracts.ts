/**
 * Public interface of the serviceability module.
 *
 * The ONLY file other modules may import from. Every export here is a
 * deliberate widening of this module's public surface (spec §2.1.1).
 *
 * `checkout` (P2.3) resolves the store for an address and books the slot;
 * `order` releases it when an order is cancelled. Both go through `SlotService`
 * — the atomic decrement in `book()` is the whole point, and reaching around it
 * to the table would reintroduce the oversell it exists to prevent.
 */

export { ServiceAreaService } from './internal/service-area.service';
export type {
  PolygonGeoJson,
  ServiceAreaInput,
  ServiceableStore,
} from './internal/service-area.service';

export { SlotService } from './internal/slot.service';
export type { SlotDefinitionInput, SlotView } from './internal/slot.service';

export type {
  ServiceAreaRow,
  SlotDefinitionRow,
  SlotInstanceRow,
  WaitlistEntryRow,
} from './schema';

export {
  DEFAULT_CUTOFF_MINUTES_BEFORE,
  ServiceAreaMode,
  SlotStatus,
  StoredSlotStatus,
  cutoffAt,
  effectiveSlotStatus,
  isBookable,
  slotCapacity,
} from '@freshkirana/contracts';
