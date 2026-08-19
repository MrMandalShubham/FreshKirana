/**
 * Public interface of the inventory module.
 *
 * The ONLY file other modules may import from. Every export here is a
 * deliberate widening of this module's public surface (spec §2.1.1).
 *
 * `checkout` reserves; the order state machine confirms, consumes and releases.
 * All of it goes through `InventoryService` — reaching around it to the stock
 * counter would take stock with no row explaining why, which is exactly the
 * drift this module exists to make reconcilable.
 */

export { InventoryService } from './internal/inventory.service';
export type { ReserveInput, ReserveResult } from './internal/inventory.service';

export type { ReservationRow } from './schema';

export {
  ReservationOutcome,
  ReservationStatus,
  availableToPromise,
  modeReserves,
  reservationTtlMinutes,
} from '@freshkirana/contracts';
