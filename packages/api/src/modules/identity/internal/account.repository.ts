import { Inject, Injectable } from '@nestjs/common';
import { type Principal, type Role, type ScopeType } from '@freshkirana/contracts';
import { and, eq } from 'drizzle-orm';
import { DATABASE } from '../../../db/db.module';
import type { Database } from '../../../db';
import { account, accountRole } from '../schema';

@Injectable()
export class AccountRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Loads the principal for a request.
   *
   * Roles come from the database on every request rather than from the token,
   * so a revoked or re-scoped role takes effect immediately. P8.6 adds a Redis
   * cache if this shows up in the §1.4.2 latency budget.
   */
  async findPrincipal(accountId: string): Promise<Principal | null> {
    const rows = await this.db
      .select({
        id: account.id,
        phone: account.phone,
        displayName: account.displayName,
        status: account.status,
        role: accountRole.role,
        scopeType: accountRole.scopeType,
        scopeId: accountRole.scopeId,
      })
      .from(account)
      .leftJoin(accountRole, eq(accountRole.accountId, account.id))
      .where(and(eq(account.id, accountId), eq(account.status, 'active')));

    const first = rows[0];
    if (!first) return null;

    return {
      accountId: first.id,
      phone: first.phone,
      displayName: first.displayName,
      roles: rows
        .filter((row) => row.role !== null)
        .map((row) => ({
          role: row.role as Role,
          scopeType: row.scopeType as ScopeType,
          scopeId: row.scopeId,
        })),
    };
  }

  async findByPhone(phone: string): Promise<{ id: string } | null> {
    const rows = await this.db
      .select({ id: account.id })
      .from(account)
      .where(eq(account.phone, phone))
      .limit(1);
    return rows[0] ?? null;
  }

  async createAccount(input: {
    phone: string;
    displayName: string;
  }): Promise<{ id: string }> {
    const rows = await this.db
      .insert(account)
      .values({ phone: input.phone, displayName: input.displayName })
      .returning({ id: account.id });

    const created = rows[0];
    if (!created) throw new Error('account insert returned no row');
    return created;
  }

  async grantRole(input: {
    accountId: string;
    role: Role;
    scopeType: ScopeType;
    scopeId: string | null;
  }): Promise<void> {
    await this.db
      .insert(accountRole)
      .values({
        accountId: input.accountId,
        role: input.role,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
      })
      .onConflictDoNothing();
  }
}
