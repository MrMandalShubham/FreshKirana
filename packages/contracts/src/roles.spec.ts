import { describe, expect, it } from 'vitest';
import {
  MFA_REQUIRED_ROLES,
  type Principal,
  ROLES,
  Role,
  ScopeType,
  hasRole,
  hasRoleAtVendor,
  isVendorScoped,
  vendorScopeIds,
} from './roles';

const VENDOR_A = 'vendor-a';
const VENDOR_B = 'vendor-b';

function principal(roles: Principal['roles']): Principal {
  return { accountId: 'acc-1', phone: '+919000000001', displayName: 'Test', roles };
}

describe('role vocabulary', () => {
  it('covers the nine roles of §3.2', () => {
    expect(ROLES).toHaveLength(9);
  });

  it('scopes only vendor roles to a resource', () => {
    expect(isVendorScoped(Role.VENDOR_OWNER)).toBe(true);
    expect(isVendorScoped(Role.VENDOR_STAFF)).toBe(true);
    expect(isVendorScoped(Role.CUSTOMER)).toBe(false);
    expect(isVendorScoped(Role.ADMIN)).toBe(false);
  });

  it('flags the roles that will require MFA at P8.6', () => {
    expect(MFA_REQUIRED_ROLES).toContain(Role.ADMIN);
    expect(MFA_REQUIRED_ROLES).toContain(Role.FINANCE);
    expect(MFA_REQUIRED_ROLES).not.toContain(Role.CUSTOMER);
  });
});

describe('hasRole', () => {
  it('matches any held role', () => {
    const p = principal([
      { role: Role.CUSTOMER, scopeType: ScopeType.GLOBAL, scopeId: null },
    ]);
    expect(hasRole(p, Role.CUSTOMER)).toBe(true);
    expect(hasRole(p, Role.ADMIN, Role.CUSTOMER)).toBe(true);
    expect(hasRole(p, Role.ADMIN)).toBe(false);
  });
});

describe('hasRoleAtVendor - §3.2 resource-level scoping', () => {
  const staffOfA = principal([
    { role: Role.VENDOR_STAFF, scopeType: ScopeType.VENDOR, scopeId: VENDOR_A },
  ]);

  it('grants access at the vendor the role is held at', () => {
    expect(hasRoleAtVendor(staffOfA, VENDOR_A, Role.VENDOR_STAFF)).toBe(true);
  });

  it('DENIES the same role at a different vendor', () => {
    // The failure this prevents: vendor-to-vendor data leakage.
    expect(hasRoleAtVendor(staffOfA, VENDOR_B, Role.VENDOR_STAFF)).toBe(false);
  });

  it('denies when the role is right but the scope is global', () => {
    const oddball = principal([
      { role: Role.VENDOR_STAFF, scopeType: ScopeType.GLOBAL, scopeId: null },
    ]);
    expect(hasRoleAtVendor(oddball, VENDOR_A, Role.VENDOR_STAFF)).toBe(false);
  });

  it('does not let a global admin role satisfy a vendor-scoped check', () => {
    const admin = principal([
      { role: Role.ADMIN, scopeType: ScopeType.GLOBAL, scopeId: null },
    ]);
    expect(hasRoleAtVendor(admin, VENDOR_A, Role.VENDOR_STAFF)).toBe(false);
  });

  it('supports a principal holding roles at several vendors', () => {
    const multi = principal([
      { role: Role.VENDOR_OWNER, scopeType: ScopeType.VENDOR, scopeId: VENDOR_A },
      { role: Role.VENDOR_STAFF, scopeType: ScopeType.VENDOR, scopeId: VENDOR_B },
    ]);
    expect(hasRoleAtVendor(multi, VENDOR_A, Role.VENDOR_OWNER)).toBe(true);
    expect(hasRoleAtVendor(multi, VENDOR_B, Role.VENDOR_OWNER)).toBe(false);
    expect(hasRoleAtVendor(multi, VENDOR_B, Role.VENDOR_STAFF)).toBe(true);
    expect(vendorScopeIds(multi).sort()).toEqual([VENDOR_A, VENDOR_B]);
  });
});
