import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CartStatus,
  type CartTotals,
  QuantityMode,
  calculateTotals,
  lineTotalPaise,
  quantityModeFor,
  quantityStepFor,
} from '@freshkirana/contracts';
import { and, eq, sql } from 'drizzle-orm';
import { DATABASE } from '../../../db/db.module';
import type { Database, Transaction } from '../../../db';
import { CatalogService } from '../../catalog/contracts';
import { OfferService } from '../../offer/contracts';
import { PricingService } from '../../pricing/contracts';
import { cart, cartLine } from '../schema';

/** Who the basket belongs to. Exactly one of these is set. */
export interface CartOwner {
  accountId?: string | null;
  anonId?: string | null;
}

export interface CartLineView {
  id: string;
  vendorOfferId: string;
  masterProductId: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  vegMark: string;

  netQuantity: number;
  uom: string;
  isVariableWeight: boolean;
  quantityMode: QuantityMode;
  quantityStep: number;

  /** Snapshotted onto the order for the invoice (§3.7.1). Already loaded here. */
  hsnCode: string;
  gstRateBp: number;

  quantity: number;
  unitPricePaise: number;
  mrpPaise: number;
  lineTotalPaise: number;
  lineMrpTotalPaise: number;

  /** True when the live price differs from the price when this was added. */
  priceChanged: boolean;
  addedAtPricePaise: number;

  /** False when the vendor has since run out or paused the listing. */
  isAvailable: boolean;
}

/** Why an item could not join the basket. */
export type SkipReason =
  'DIFFERENT_STORE' | 'OUT_OF_STOCK' | 'NO_LONGER_LISTED' | 'UNAVAILABLE';

export interface SkippedItem {
  vendorOfferId: string;
  reason: SkipReason;
}

export interface CartView {
  id: string;
  vendorId: string | null;
  substitutionPreference: string;
  lines: CartLineView[];
  totals: CartTotals;
  /** Lines that can no longer be bought. Surfaced rather than silently dropped. */
  unavailableLineIds: string[];
}

@Injectable()
export class CartService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly offers: OfferService,
    private readonly catalog: CatalogService,
    private readonly pricing: PricingService,
  ) {}

  /** Finds the shopper's active cart, creating one only when something is added. */
  async findActive(owner: CartOwner) {
    this.assertOwner(owner);

    const rows = await this.db
      .select()
      .from(cart)
      .where(
        and(
          eq(cart.status, CartStatus.ACTIVE),
          owner.accountId
            ? eq(cart.accountId, owner.accountId)
            : eq(cart.anonId, owner.anonId!),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  async view(owner: CartOwner): Promise<CartView> {
    const existing = await this.findActive(owner);
    if (!existing) {
      return {
        id: '',
        vendorId: null,
        substitutionPreference: 'AUTO_SUBSTITUTE',
        lines: [],
        totals: calculateTotals([], this.pricing.getFees()),
        unavailableLineIds: [],
      };
    }
    return this.render(existing.id);
  }

  /**
   * Adds an offer to the basket, or increases its quantity.
   *
   * Enforces decision D2: the cart pins to a vendor on the first line, and a
   * second vendor is refused with the information needed to resolve it, rather
   * than silently discarding either basket.
   */
  async addItem(
    owner: CartOwner,
    input: { vendorOfferId: string; quantity?: number },
  ): Promise<CartView> {
    this.assertOwner(owner);

    const offer = await this.offers.findById(input.vendorOfferId);
    if (!offer) {
      throw new NotFoundException(`Offer ${input.vendorOfferId} not found`);
    }

    if (!this.offers.isPurchasable(offer)) {
      throw new ConflictException('That item is out of stock right now');
    }

    const product = await this.catalog.getProduct(offer.masterProductId);
    const quantity = this.normaliseQuantity(product, input.quantity);

    let current = await this.findActive(owner);

    if (current && current.vendorId && current.vendorId !== offer.vendorId) {
      // Deliberately a 409 carrying both vendor ids: the UI needs to offer
      // "switch shop and start again", and cannot without knowing what it is
      // switching between.
      throw new ConflictException({
        message:
          'Your basket is from another shop. One order is fulfilled by one store, so items from a second shop need a new basket.',
        code: 'CART_VENDOR_CONFLICT',
        currentVendorId: current.vendorId,
        requestedVendorId: offer.vendorId,
      });
    }

    if (!current) {
      const created = await this.db
        .insert(cart)
        .values({
          accountId: owner.accountId ?? null,
          anonId: owner.anonId ?? null,
          vendorId: offer.vendorId,
        })
        .returning();
      current = created[0]!;
    } else if (!current.vendorId) {
      const updated = await this.db
        .update(cart)
        .set({ vendorId: offer.vendorId, updatedAt: new Date() })
        .where(eq(cart.id, current.id))
        .returning();
      current = updated[0]!;
    }

    // Adding the same offer again increases the quantity rather than showing
    // the shopper the same product on two lines.
    await this.db
      .insert(cartLine)
      .values({
        cartId: current.id,
        vendorOfferId: offer.id,
        masterProductId: offer.masterProductId,
        quantity,
        addedAtPricePaise: offer.sellingPricePaise,
      })
      .onConflictDoUpdate({
        target: [cartLine.cartId, cartLine.vendorOfferId],
        set: {
          quantity: sql`${cartLine.quantity} + ${quantity}`,
          updatedAt: new Date(),
        },
      });

    await this.touch(current.id);
    return this.render(current.id);
  }

  /**
   * Adds several items at once — the one-tap "add my usual basket" (§4.2).
   *
   * **Partial success by design.** A basket is pinned to one store (D2), and a
   * predicted basket is assembled from what somebody bought over months,
   * possibly at different shops, some of it now out of stock. Refusing the
   * whole request because item nine is unavailable turns one tap into a puzzle;
   * silently dropping it means they find out at the door.
   *
   * So it adds what it can and *names* what it could not, for the caller to
   * show. Anything skipped is a thing the shopper may still want to look for.
   */
  async addMany(
    owner: CartOwner,
    items: ReadonlyArray<{ vendorOfferId: string; quantity?: number }>,
  ): Promise<{ cart: CartView; added: string[]; skipped: SkippedItem[] }> {
    this.assertOwner(owner);

    const added: string[] = [];
    const skipped: SkippedItem[] = [];

    for (const item of items) {
      try {
        await this.addItem(owner, item);
        added.push(item.vendorOfferId);
      } catch (error) {
        skipped.push({
          vendorOfferId: item.vendorOfferId,
          reason: this.skipReason(error),
        });
      }
    }

    return { cart: await this.view(owner), added, skipped };
  }

  /** Why one item of a bulk add did not make it, in a word the UI can branch on. */
  private skipReason(error: unknown): SkipReason {
    const response = (error as { response?: { code?: string } } | null)?.response;
    if (response?.code === 'CART_VENDOR_CONFLICT') return 'DIFFERENT_STORE';

    if (error instanceof NotFoundException) return 'NO_LONGER_LISTED';
    if (error instanceof ConflictException) return 'OUT_OF_STOCK';

    return 'UNAVAILABLE';
  }

  async updateQuantity(
    owner: CartOwner,
    lineId: string,
    quantity: number,
  ): Promise<CartView> {
    const current = await this.requireCart(owner);
    const line = await this.requireLine(current.id, lineId);

    const offer = await this.offers.findById(line.vendorOfferId);
    if (!offer) throw new NotFoundException('That item is no longer listed');

    const product = await this.catalog.getProduct(offer.masterProductId);
    const normalised = this.normaliseQuantity(product, quantity);

    await this.db
      .update(cartLine)
      .set({ quantity: normalised, updatedAt: new Date() })
      .where(eq(cartLine.id, lineId));

    await this.touch(current.id);
    return this.render(current.id);
  }

  async removeItem(owner: CartOwner, lineId: string): Promise<CartView> {
    const current = await this.requireCart(owner);
    await this.requireLine(current.id, lineId);

    await this.db.delete(cartLine).where(eq(cartLine.id, lineId));
    await this.releaseVendorIfEmpty(current.id);
    await this.touch(current.id);

    return this.render(current.id);
  }

  async clear(owner: CartOwner): Promise<CartView> {
    const current = await this.findActive(owner);
    if (!current) return this.view(owner);

    await this.db.delete(cartLine).where(eq(cartLine.cartId, current.id));
    await this.db
      .update(cart)
      .set({ vendorId: null, updatedAt: new Date() })
      .where(eq(cart.id, current.id));

    return this.render(current.id);
  }

  async setSubstitutionPreference(
    owner: CartOwner,
    preference: string,
  ): Promise<CartView> {
    const current = await this.requireCart(owner);

    await this.db
      .update(cart)
      .set({ substitutionPreference: preference, updatedAt: new Date() })
      .where(eq(cart.id, current.id));

    return this.render(current.id);
  }

  /**
   * Claims an anonymous basket for an account on sign-in.
   *
   * If the account already has a basket, the anonymous one wins: it is what the
   * shopper was just looking at. Their older basket is abandoned rather than
   * merged, because merging two single-vendor baskets from different shops has
   * no correct answer (D2) and silently dropping half is worse than either.
   */
  async claim(anonId: string, accountId: string): Promise<CartView> {
    const anonymous = await this.findActive({ anonId });
    if (!anonymous) return this.view({ accountId });

    const existing = await this.findActive({ accountId });

    if (existing) {
      await this.db
        .update(cart)
        .set({ status: CartStatus.ABANDONED, updatedAt: new Date() })
        .where(eq(cart.id, existing.id));
    }

    const claimed = await this.db
      .update(cart)
      .set({ accountId, anonId: null, updatedAt: new Date() })
      .where(eq(cart.id, anonymous.id))
      .returning();

    return this.render(claimed[0]!.id);
  }

  /**
   * Marks a basket as having become an order.
   *
   * Takes checkout's transaction: the cart must close in the same instant the
   * order is written, or a shopper could place a second order from a basket
   * they have already bought. Kept as CONVERTED rather than deleted, because
   * the §5.2 funnel needs to know it converted.
   */
  async markConverted(
    cartId: string,
    tx: Transaction | Database = this.db,
  ): Promise<void> {
    await tx
      .update(cart)
      .set({ status: CartStatus.CONVERTED, updatedAt: new Date() })
      .where(eq(cart.id, cartId));
  }

  // -------------------------------------------------------------------------

  /**
   * Builds the view, pricing every line from the **live** offer.
   *
   * The stored price is only ever used to tell the shopper it changed. Charging
   * from a snapshot would either short the vendor or overcharge the customer,
   * and grocery prices move daily.
   */
  private async render(cartId: string): Promise<CartView> {
    // Read the cart here rather than trusting the row a caller happens to hold:
    // `removeItem` clears the vendor pin *after* it read the cart, and rendering
    // from that copy would tell the client the basket is still pinned to a shop
    // it is not — so the UI would keep refusing a second shop the server allows.
    const rows = await this.db.select().from(cart).where(eq(cart.id, cartId)).limit(1);
    const current = rows[0];
    if (!current) throw new NotFoundException('No active basket');

    const lines = await this.db
      .select()
      .from(cartLine)
      .where(eq(cartLine.cartId, current.id))
      .orderBy(cartLine.createdAt);

    const views: CartLineView[] = [];
    const unavailableLineIds: string[] = [];

    for (const line of lines) {
      const offer = await this.offers.findById(line.vendorOfferId);
      const product = await this.catalog.getProduct(line.masterProductId);

      // A delisted offer leaves the line visible but unbuyable: removing it
      // silently would let a shopper reach checkout believing they had ordered
      // something they had not.
      if (!offer) {
        unavailableLineIds.push(line.id);
        continue;
      }

      const isAvailable = this.offers.isPurchasable(offer);
      if (!isAvailable) unavailableLineIds.push(line.id);

      const shape = {
        isVariableWeight: product.isVariableWeight,
        uom: product.uom,
      };

      const totalPaise = lineTotalPaise({
        unitPricePaise: offer.sellingPricePaise,
        quantity: line.quantity,
        netQuantity: product.netQuantity,
        isVariableWeight: product.isVariableWeight,
        uom: product.uom,
      });

      const mrpTotalPaise = lineTotalPaise({
        unitPricePaise: offer.mrpPaise,
        quantity: line.quantity,
        netQuantity: product.netQuantity,
        isVariableWeight: product.isVariableWeight,
        uom: product.uom,
      });

      views.push({
        id: line.id,
        vendorOfferId: line.vendorOfferId,
        masterProductId: line.masterProductId,
        name: product.name,
        slug: product.slug,
        imageUrl: product.images[0] ?? null,
        vegMark: product.vegMark,

        netQuantity: product.netQuantity,
        uom: product.uom,
        isVariableWeight: product.isVariableWeight,
        quantityMode: quantityModeFor(shape),
        quantityStep: quantityStepFor(shape),

        hsnCode: product.hsnCode,
        gstRateBp: product.gstRateBp,

        quantity: line.quantity,
        unitPricePaise: offer.sellingPricePaise,
        mrpPaise: offer.mrpPaise,
        lineTotalPaise: totalPaise,
        lineMrpTotalPaise: mrpTotalPaise,

        priceChanged: offer.sellingPricePaise !== line.addedAtPricePaise,
        addedAtPricePaise: line.addedAtPricePaise,
        isAvailable,
      });
    }

    // Unavailable lines are shown but excluded from the total: the shopper must
    // not be quoted a price that includes something nobody can supply.
    const billable = views.filter((line) => line.isAvailable);

    return {
      id: current.id,
      vendorId: current.vendorId,
      substitutionPreference: current.substitutionPreference,
      lines: views,
      totals: calculateTotals(
        billable,
        this.pricing.getFees(current.vendorId ?? undefined),
      ),
      unavailableLineIds,
    };
  }

  /**
   * Rounds a requested quantity to something the vendor can actually weigh out.
   *
   * A shopper asking for 300 g of a product that steps in 250 g gets 250 g, not
   * a picker guessing. Packs are already whole by construction.
   */
  private normaliseQuantity(
    product: { isVariableWeight: boolean; uom: string },
    requested: number | undefined,
  ): number {
    const step = quantityStepFor(product);
    const raw = requested ?? step;

    if (!Number.isFinite(raw) || raw <= 0) {
      throw new BadRequestException('Quantity must be a positive number');
    }

    const rounded = Math.max(step, Math.round(raw / step) * step);
    if (rounded > 1_000_000) {
      throw new BadRequestException('That quantity is not plausible for a grocery order');
    }

    return rounded;
  }

  /** Clears the vendor pin once the basket empties, so any shop may be chosen next. */
  private async releaseVendorIfEmpty(cartId: string): Promise<void> {
    const remaining = await this.db
      .select({ id: cartLine.id })
      .from(cartLine)
      .where(eq(cartLine.cartId, cartId))
      .limit(1);

    if (remaining.length === 0) {
      await this.db.update(cart).set({ vendorId: null }).where(eq(cart.id, cartId));
    }
  }

  private async touch(cartId: string): Promise<void> {
    await this.db.update(cart).set({ updatedAt: new Date() }).where(eq(cart.id, cartId));
  }

  private async requireCart(owner: CartOwner) {
    const current = await this.findActive(owner);
    if (!current) throw new NotFoundException('No active basket');
    return current;
  }

  private async requireLine(cartId: string, lineId: string) {
    const rows = await this.db
      .select()
      .from(cartLine)
      .where(and(eq(cartLine.id, lineId), eq(cartLine.cartId, cartId)))
      .limit(1);

    const line = rows[0];
    // Scoped to this cart: another shopper's line is *not found*, never
    // forbidden, so the response cannot confirm that it exists.
    if (!line) throw new NotFoundException(`Item ${lineId} is not in your basket`);
    return line;
  }

  private assertOwner(owner: CartOwner): void {
    if (!owner.accountId && !owner.anonId) {
      throw new BadRequestException(
        'A basket needs an owner: sign in, or send an x-cart-token header',
      );
    }
  }
}
