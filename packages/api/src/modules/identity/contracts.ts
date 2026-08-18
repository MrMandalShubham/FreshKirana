/**
 * Public interface of the identity module.
 *
 * The ONLY file other modules may import from. Every export here is a
 * deliberate widening of this module's public surface (spec §2.1.1).
 */

export { CurrentUser, Public, Roles } from './internal/decorators';

export { AccountRepository } from './internal/account.repository';

/**
 * Apply with `@UseGuards(VendorScopeGuard)` on any route carrying a
 * `:vendorId` param. See the guard for why `@Roles` alone is insufficient.
 */
export { VendorScopeGuard } from './internal/vendor-scope.guard';

/**
 * Re-exported for convenience so handlers need one import, not two.
 * `hasRoleAtVendor` is the §3.2 resource-level check every vendor-scoped
 * handler must perform — a `@Roles(VENDOR_STAFF)` decorator alone is not
 * authorisation, because staff of *any* store satisfy it.
 */
export {
  type Principal,
  type Role,
  type RoleAssignment,
  hasRole,
  hasRoleAtVendor,
  vendorScopeIds,
} from '@freshkirana/contracts';
