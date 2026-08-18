import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type LatLng, isPlausiblyInIndia } from '@freshkirana/contracts';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { DATABASE } from '../../../db/db.module';
import type { Database } from '../../../db';
import { address } from '../schema';

export interface CreateAddressInput {
  label?: string;
  recipientName: string;
  recipientPhone: string;
  line1: string;
  line2?: string;
  landmark?: string;
  city: string;
  state: string;
  pincode: string;
  latitude: number;
  longitude: number;
  deliveryNote?: string;
  isDefault?: boolean;
}

export type UpdateAddressInput = Partial<CreateAddressInput>;

@Injectable()
export class AddressService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** The shopper's addresses, default first, then most recently used. */
  async list(accountId: string) {
    return this.db
      .select()
      .from(address)
      .where(and(eq(address.accountId, accountId), isNull(address.deletedAt)))
      .orderBy(desc(address.isDefault), desc(address.createdAt));
  }

  async get(accountId: string, addressId: string) {
    const rows = await this.db
      .select()
      .from(address)
      .where(
        and(
          eq(address.id, addressId),
          eq(address.accountId, accountId),
          isNull(address.deletedAt),
        ),
      )
      .limit(1);

    const found = rows[0];
    // Scoped to the account: someone else's address is *not found*, never
    // forbidden, so the response cannot confirm that it exists.
    if (!found) throw new NotFoundException(`Address ${addressId} not found`);
    return found;
  }

  async create(accountId: string, input: CreateAddressInput) {
    this.assertPlausibleCoordinates(input);

    // The first address a shopper saves is their default, whatever they ticked:
    // an account with addresses and no default has no answer to "deliver where?"
    const existing = await this.list(accountId);
    const isDefault = input.isDefault ?? existing.length === 0;

    if (isDefault) await this.clearDefault(accountId);

    const created = await this.db
      .insert(address)
      .values({ ...input, accountId, isDefault })
      .returning();

    return created[0]!;
  }

  async update(accountId: string, addressId: string, input: UpdateAddressInput) {
    await this.get(accountId, addressId);

    if (input.latitude !== undefined || input.longitude !== undefined) {
      const current = await this.get(accountId, addressId);
      this.assertPlausibleCoordinates({
        latitude: input.latitude ?? current.latitude,
        longitude: input.longitude ?? current.longitude,
      });
    }

    if (input.isDefault) await this.clearDefault(accountId);

    const updated = await this.db
      .update(address)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(address.id, addressId))
      .returning();

    return updated[0]!;
  }

  async makeDefault(accountId: string, addressId: string) {
    await this.get(accountId, addressId);
    await this.clearDefault(accountId);

    const updated = await this.db
      .update(address)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(eq(address.id, addressId))
      .returning();

    return updated[0]!;
  }

  /**
   * Soft-deletes an address.
   *
   * Orders reference the address they were delivered to, so the row stays.
   * Removing the default promotes the next one rather than leaving the account
   * with addresses and nothing selected.
   */
  async remove(accountId: string, addressId: string): Promise<void> {
    const existing = await this.get(accountId, addressId);

    await this.db
      .update(address)
      .set({ deletedAt: new Date(), isDefault: false, updatedAt: new Date() })
      .where(eq(address.id, addressId));

    if (!existing.isDefault) return;

    const remaining = await this.list(accountId);
    const next = remaining[0];
    if (next) {
      await this.db
        .update(address)
        .set({ isDefault: true, updatedAt: new Date() })
        .where(eq(address.id, next.id));
    }
  }

  /** The address to deliver to unless the shopper picks another. */
  async findDefault(accountId: string) {
    const rows = await this.db
      .select()
      .from(address)
      .where(
        and(
          eq(address.accountId, accountId),
          eq(address.isDefault, true),
          isNull(address.deletedAt),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  private async clearDefault(accountId: string): Promise<void> {
    await this.db
      .update(address)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(and(eq(address.accountId, accountId), eq(address.isDefault, true)));
  }

  /**
   * Rejects a pin that cannot be an Indian address.
   *
   * The database enforces the same bounds, but a 400 naming the problem is far
   * more useful to a client than a constraint violation, and the most likely
   * cause — latitude and longitude swapped — is worth saying out loud.
   */
  private assertPlausibleCoordinates(point: LatLng): void {
    if (!isPlausiblyInIndia(point)) {
      throw new BadRequestException(
        'Those coordinates are not in India. Check that latitude and longitude are not swapped.',
      );
    }
  }
}
