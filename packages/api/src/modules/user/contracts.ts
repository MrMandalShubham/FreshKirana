/**
 * Public interface of the user module.
 *
 * The ONLY file other modules may import from. Every export here is a
 * deliberate widening of this module's public surface (spec §2.1.1).
 *
 * `serviceability` resolves an address to serviceable stores, and `checkout`
 * (P2.3) needs the address a shopper chose — both take the row, never the table.
 */

export { AddressService } from './internal/address.service';
export type { CreateAddressInput, UpdateAddressInput } from './internal/address.service';

export type { AddressRow } from './schema';

export { AddressLabel } from '@freshkirana/contracts';
