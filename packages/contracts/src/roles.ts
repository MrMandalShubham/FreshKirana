/**
 * Roles and authorisation vocabulary (spec §3.2).
 *
 * Shared between the API and every frontend so a role rename is a compile
 * error everywhere it is wrong.
 */

export const Role = {
  CUSTOMER: 'CUSTOMER',
  VENDOR_OWNER: 'VENDOR_OWNER',
  VENDOR_STAFF: 'VENDOR_STAFF',
  RIDER: 'RIDER',
  FLEET_MANAGER: 'FLEET_MANAGER',
  ADMIN: 'ADMIN',
  OPS: 'OPS',
  FINANCE: 'FINANCE',
  SUPPORT: 'SUPPORT',
} as const;

export type Role = (typeof Role)[keyof typeof Role];

export const ROLES = Object.values(Role);

/**
 * What a role's authority is bounded by.
 *
 * `VENDOR`-scoped roles are the reason §3.2 demands resource-level checks on
 * top of role checks: vendor staff hold the same role at every store, so the
 * role alone never authorises access — the scope must match too.
 */
export const ScopeType = {
  GLOBAL: 'GLOBAL',
  VENDOR: 'VENDOR',
} as const;

export type ScopeType = (typeof ScopeType)[keyof typeof ScopeType];

export const ROLE_SCOPE: Record<Role, ScopeType> = {
  CUSTOMER: ScopeType.GLOBAL,
  VENDOR_OWNER: ScopeType.VENDOR,
  VENDOR_STAFF: ScopeType.VENDOR,
  RIDER: ScopeType.GLOBAL,
  FLEET_MANAGER: ScopeType.GLOBAL,
  ADMIN: ScopeType.GLOBAL,
  OPS: ScopeType.GLOBAL,
  FINANCE: ScopeType.GLOBAL,
  SUPPORT: ScopeType.GLOBAL,
};

export function isVendorScoped(role: Role): boolean {
  return ROLE_SCOPE[role] === ScopeType.VENDOR;
}

/** Roles that require MFA once P8.6 lands (§3.1). */
export const MFA_REQUIRED_ROLES: readonly Role[] = [
  Role.ADMIN,
  Role.FINANCE,
  Role.FLEET_MANAGER,
];

/** A role assignment: the role plus the resource it is bounded to. */
export interface RoleAssignment {
  role: Role;
  scopeType: ScopeType;
  /** Vendor id for VENDOR-scoped roles; null for GLOBAL. */
  scopeId: string | null;
}

/** The authenticated principal, as carried on every request. */
export interface Principal {
  accountId: string;
  phone: string;
  displayName: string;
  roles: RoleAssignment[];
}

export function hasRole(principal: Principal, ...roles: Role[]): boolean {
  return principal.roles.some((assignment) => roles.includes(assignment.role));
}

/**
 * Role check *and* scope check together (§3.2).
 *
 * Returns true only if the principal holds one of `roles` **at this vendor**.
 * A VENDOR_STAFF of store A must never satisfy a check for store B.
 */
export function hasRoleAtVendor(
  principal: Principal,
  vendorId: string,
  ...roles: Role[]
): boolean {
  return principal.roles.some(
    (assignment) =>
      roles.includes(assignment.role) &&
      assignment.scopeType === ScopeType.VENDOR &&
      assignment.scopeId === vendorId,
  );
}

/** Vendor ids this principal has any vendor-scoped role at. */
export function vendorScopeIds(principal: Principal): string[] {
  return principal.roles
    .filter((a) => a.scopeType === ScopeType.VENDOR && a.scopeId !== null)
    .map((a) => a.scopeId as string);
}
