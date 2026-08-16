import { Injectable, NotFoundException } from '@nestjs/common';
import { ROLE_SCOPE, ROLES, type Role, ScopeType } from '@freshkirana/contracts';
import { AccountRepository } from './account.repository';
import { TokenService } from './token.service';

/** Deterministic vendor ids for seeded vendor-scoped roles. */
export const SEED_VENDOR_A = '00000000-0000-4000-8000-0000000000a1';
export const SEED_VENDOR_B = '00000000-0000-4000-8000-0000000000b2';

/** One seeded phone per role, so `login-as` is reproducible across resets. */
export function seedPhoneFor(role: Role): string {
  const index = ROLES.indexOf(role) + 1;
  return `+9190000000${String(index).padStart(2, '0')}`;
}

function displayNameFor(role: Role): string {
  return `Dev ${role.toLowerCase().replace(/_/g, ' ')}`;
}

/**
 * Seeds and logs in development accounts (P0.3a).
 *
 * Accounts are created on demand and are idempotent, so `db:reset` costs
 * nothing: the first `login-as` recreates whatever is missing.
 */
@Injectable()
export class DevAuthService {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly tokens: TokenService,
  ) {}

  async loginAs(
    role: Role,
    vendorId: string = SEED_VENDOR_A,
  ): Promise<{ token: string; accountId: string; role: Role; vendorId: string | null }> {
    const scopeType = ROLE_SCOPE[role];
    const scopeId = scopeType === ScopeType.VENDOR ? vendorId : null;

    const accountId = await this.ensureAccount(role);
    await this.accounts.grantRole({ accountId, role, scopeType, scopeId });

    return {
      token: await this.tokens.issue(accountId),
      accountId,
      role,
      vendorId: scopeId,
    };
  }

  async listSeededAccounts(): Promise<
    Array<{ role: Role; phone: string; exists: boolean }>
  > {
    return Promise.all(
      ROLES.map(async (role) => {
        const phone = seedPhoneFor(role);
        return { role, phone, exists: (await this.accounts.findByPhone(phone)) !== null };
      }),
    );
  }

  /**
   * A second seeded account for the *same* role at a *different* vendor.
   * Exists so the §3.2 cross-vendor denial can actually be exercised.
   */
  async loginAsVendorB(role: Role): Promise<{ token: string; vendorId: string }> {
    const phone = `${seedPhoneFor(role)}-b`;
    const existing = await this.accounts.findByPhone(phone);
    const accountId =
      existing?.id ??
      (
        await this.accounts.createAccount({
          phone,
          displayName: `${displayNameFor(role)} (B)`,
        })
      ).id;

    await this.accounts.grantRole({
      accountId,
      role,
      scopeType: ScopeType.VENDOR,
      scopeId: SEED_VENDOR_B,
    });

    return { token: await this.tokens.issue(accountId), vendorId: SEED_VENDOR_B };
  }

  private async ensureAccount(role: Role): Promise<string> {
    const phone = seedPhoneFor(role);
    const existing = await this.accounts.findByPhone(phone);
    if (existing) return existing.id;

    const created = await this.accounts.createAccount({
      phone,
      displayName: displayNameFor(role),
    });
    if (!created.id) throw new NotFoundException('Failed to seed dev account');
    return created.id;
  }
}
