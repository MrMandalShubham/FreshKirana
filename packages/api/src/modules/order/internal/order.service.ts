import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  OrderLineStatus,
  OrderStatus,
  type PaymentMethod,
  PaymentStatus,
  formatOrderNumber,
  istDateKey,
  taxWithinInclusivePaise,
} from '@freshkirana/contracts';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DATABASE } from '../../../db/db.module';
import type { Database, Transaction } from '../../../db';
import { order, orderLine } from '../schema';

export interface CreateOrderLineInput {
  masterProductId: string;
  vendorOfferId: string;
  name: string;
  slug: string;
  netQuantity: number;
  uom: string;
  isVariableWeight: boolean;
  hsnCode: string;
  gstRateBp: number;
  quantity: number;
  unitPricePaise: number;
  mrpPaise: number;
  lineTotalPaise: number;
  lineMrpTotalPaise: number;
}

export interface CreateOrderInput {
  accountId: string;
  vendorId: string;
  cartId: string;
  paymentMethod: PaymentMethod;
  substitutionPreference: string;

  address: {
    id: string;
    recipientName: string;
    recipientPhone: string;
    line1: string;
    line2?: string | null;
    landmark?: string | null;
    city: string;
    state: string;
    pincode: string;
    latitude: number;
    longitude: number;
    deliveryNote?: string | null;
  };

  slot: {
    id: string;
    serviceDate: string;
    startsAt: Date;
    endsAt: Date;
  };

  totals: {
    itemsSubtotalPaise: number;
    savingsPaise: number;
    deliveryFeePaise: number;
    smallBasketFeePaise: number;
    packagingFeePaise: number;
    grandTotalPaise: number;
  };

  lines: CreateOrderLineInput[];
}

@Injectable()
export class OrderService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Writes the order and its lines.
   *
   * Takes a transaction because it is one step of checkout's atomic sequence:
   * the slot booking, the order and the cart's conversion either all happen or
   * none do. An order without its slot is an order the store never hears about
   * at a time it never agreed to.
   */
  async create(input: CreateOrderInput, tx: Transaction | Database = this.db) {
    const orderNumber = await this.nextOrderNumber(tx);

    const lines = input.lines.map((line) => ({
      ...line,
      taxPaise: taxWithinInclusivePaise(line.lineTotalPaise, line.gstRateBp),
      status: OrderLineStatus.PENDING,
    }));

    const taxTotalPaise = lines.reduce((sum, line) => sum + line.taxPaise, 0);

    const created = await tx
      .insert(order)
      .values({
        orderNumber,
        accountId: input.accountId,
        vendorId: input.vendorId,
        cartId: input.cartId,

        // COD skips PENDING_PAYMENT entirely: there is no payment to wait for,
        // so the store hears about it immediately (§2.6.1, §2.6.2). The order
        // sits at payment PENDING until the rider collects.
        status: OrderStatus.AWAITING_VENDOR,
        paymentStatus: PaymentStatus.PENDING,
        paymentMethod: input.paymentMethod,
        substitutionPreference: input.substitutionPreference,

        addressId: input.address.id,
        recipientName: input.address.recipientName,
        recipientPhone: input.address.recipientPhone,
        addressLine1: input.address.line1,
        addressLine2: input.address.line2 ?? null,
        addressLandmark: input.address.landmark ?? null,
        addressCity: input.address.city,
        addressState: input.address.state,
        addressPincode: input.address.pincode,
        addressLatitude: input.address.latitude,
        addressLongitude: input.address.longitude,
        deliveryNote: input.address.deliveryNote ?? null,

        slotInstanceId: input.slot.id,
        slotServiceDate: input.slot.serviceDate,
        slotStartsAt: input.slot.startsAt,
        slotEndsAt: input.slot.endsAt,

        ...input.totals,
        taxTotalPaise,
        codCollectablePaise:
          input.paymentMethod === 'COD' ? input.totals.grandTotalPaise : 0,
      })
      .returning();

    const row = created[0]!;

    await tx.insert(orderLine).values(
      lines.map((line) => ({
        orderId: row.id,
        masterProductId: line.masterProductId,
        vendorOfferId: line.vendorOfferId,
        name: line.name,
        slug: line.slug,
        netQuantity: line.netQuantity,
        uom: line.uom,
        isVariableWeight: line.isVariableWeight,
        hsnCode: line.hsnCode,
        gstRateBp: line.gstRateBp,
        quantity: line.quantity,
        unitPricePaise: line.unitPricePaise,
        mrpPaise: line.mrpPaise,
        lineTotalPaise: line.lineTotalPaise,
        lineMrpTotalPaise: line.lineMrpTotalPaise,
        taxPaise: line.taxPaise,
        status: line.status,
      })),
    );

    return row;
  }

  /** The order placed from this cart, if there is one. Backs idempotent placing. */
  async findByCart(cartId: string, tx: Transaction | Database = this.db) {
    const rows = await tx.select().from(order).where(eq(order.cartId, cartId)).limit(1);
    return rows[0] ?? null;
  }

  async findForAccount(accountId: string, orderId: string) {
    const rows = await this.db
      .select()
      .from(order)
      .where(and(eq(order.id, orderId), eq(order.accountId, accountId)))
      .limit(1);

    const found = rows[0];
    // Scoped to the account: someone else's order is *not found*, never
    // forbidden, so the response cannot confirm that it exists.
    if (!found) throw new NotFoundException(`Order ${orderId} not found`);

    return { ...found, lines: await this.linesOf(found.id) };
  }

  /** Order history, newest first (§1.5.1). */
  async listForAccount(
    accountId: string,
    options: { limit?: number; offset?: number } = {},
  ) {
    const limit = Math.min(options.limit ?? 20, 50);

    const rows = await this.db
      .select()
      .from(order)
      .where(eq(order.accountId, accountId))
      .orderBy(desc(order.placedAt))
      .limit(limit)
      .offset(options.offset ?? 0);

    return Promise.all(
      rows.map(async (row) => ({ ...row, lines: await this.linesOf(row.id) })),
    );
  }

  /** The store's queue. Vendor-facing routes scope this by `:vendorId` (§3.2). */
  async listForVendor(
    vendorId: string,
    options: { status?: string; limit?: number } = {},
  ) {
    const filters = [eq(order.vendorId, vendorId)];
    if (options.status) filters.push(eq(order.status, options.status));

    const rows = await this.db
      .select()
      .from(order)
      .where(and(...filters))
      .orderBy(desc(order.placedAt))
      .limit(Math.min(options.limit ?? 20, 50));

    return Promise.all(
      rows.map(async (row) => ({ ...row, lines: await this.linesOf(row.id) })),
    );
  }

  private async linesOf(orderId: string) {
    return this.db
      .select()
      .from(orderLine)
      .where(eq(orderLine.orderId, orderId))
      .orderBy(orderLine.createdAt);
  }

  /**
   * The next order number, from a Postgres sequence.
   *
   * A sequence rather than `count(*) + 1` or a random string: counting races
   * under concurrency and would hand two simultaneous orders the same number,
   * which is the one thing this identifier cannot do. `nextval` is atomic and
   * never reuses a value, even when the surrounding transaction rolls back —
   * a gap in the numbering is harmless, a collision is not.
   */
  private async nextOrderNumber(tx: Transaction | Database): Promise<string> {
    const result = await tx.execute<{ value: string }>(
      sql`select nextval('"order".order_number_seq') as value`,
    );

    const row = (result as unknown as { rows: Array<{ value: string }> }).rows[0];
    return formatOrderNumber(istDateKey(new Date()), Number(row!.value));
  }
}
