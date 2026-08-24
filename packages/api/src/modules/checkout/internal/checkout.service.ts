import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PaymentMethod,
  type PaymentIntent,
  ReservationOutcome,
  SubstitutionPreference,
  type CartTotals,
  needsGateway,
  reservationTtlMinutes,
} from '@freshkirana/contracts';
import { DATABASE } from '../../../db/db.module';
import type { Database } from '../../../db';
import { CartService, type CartView } from '../../cart/contracts';
import { InventoryService } from '../../inventory/contracts';
import { PaymentService } from '../../payment/contracts';
import {
  CodFlowService,
  OrderService,
  BranchOrderFlowService,
} from '../../order/contracts';
import {
  ServiceAreaService,
  SlotService,
  type SlotView,
} from '../../serviceability/contracts';
import { AddressService } from '../../user/contracts';

export interface CheckoutPreview {
  cart: CartView;
  address: {
    id: string;
    recipientName: string;
    line1: string;
    city: string;
    pincode: string;
  } | null;
  slot: SlotView | null;
  totals: CartTotals;
  /** Empty means the order can be placed. Each entry is a reason it cannot. */
  blockers: CheckoutBlocker[];
  /**
   * Whether cash on delivery may be chosen (§2.10.4).
   *
   * Here rather than discovered on submit: §2.10.4 says BLOCKED is "shown
   * transparently at checkout", and a payment method that disappears at the
   * last step reads as a bug rather than a decision.
   */
  cod: {
    available: boolean;
    /** Why not, in words a customer can read. Empty when it is available. */
    reasons: string[];
    /** What confirming will cost them: NONE, QUICK_REPLY or OTP. */
    confirmation: string;
  };
}

export interface CheckoutBlocker {
  code: string;
  message: string;
}

export interface PlaceOrderInput {
  addressId: string;
  slotInstanceId: string;
  substitutionPreference?: string;
  paymentMethod?: string;
}

/**
 * Turns a basket into an order (spec §2.2 `checkout`).
 *
 * Orchestration only — this module owns no tables. It validates through each
 * other module's contracts, then writes through them inside one transaction.
 */
@Injectable()
export class CheckoutService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly carts: CartService,
    private readonly addresses: AddressService,
    private readonly areas: ServiceAreaService,
    private readonly slots: SlotService,
    private readonly orders: OrderService,
    private readonly vendorFlow: BranchOrderFlowService,
    private readonly codFlow: CodFlowService,
    private readonly inventory: InventoryService,
    private readonly payments: PaymentService,
  ) {}

  /**
   * The review screen, and the honest answer to "can I place this?".
   *
   * Returns every blocker rather than the first one. A checkout that rejects
   * one problem at a time makes the shopper discover the next only after fixing
   * this one, which is how a two-minute fix becomes an abandoned basket.
   */
  async preview(
    accountId: string,
    input: Partial<PlaceOrderInput>,
  ): Promise<CheckoutPreview> {
    const cart = await this.carts.view({ accountId });
    const blockers: CheckoutBlocker[] = [];

    if (cart.lines.length === 0) {
      blockers.push({ code: 'CART_EMPTY', message: 'Your basket is empty' });
    }

    if (cart.unavailableLineIds.length > 0) {
      blockers.push({
        code: 'LINES_UNAVAILABLE',
        message: 'Some items are no longer available. Remove them to continue.',
      });
    }

    const address = input.addressId
      ? await this.addresses.get(accountId, input.addressId).catch(() => null)
      : await this.addresses.findDefault(accountId);

    if (input.addressId && !address) {
      blockers.push({ code: 'ADDRESS_NOT_FOUND', message: 'That address is not yours' });
    } else if (!address) {
      blockers.push({ code: 'ADDRESS_REQUIRED', message: 'Choose a delivery address' });
    }

    // The cart is pinned to a branch (D2), so the question is not "is this
    // address serviceable by anyone" but "by *this* store". A shopper who
    // filled a basket at one shop and then chose an address that shop cannot
    // reach must be told here, not at the door.
    if (address && cart.branchId) {
      const serviceable = await this.areas.resolveStores(address, 50);
      if (!serviceable.some((store) => store.branchId === cart.branchId)) {
        blockers.push({
          code: 'ADDRESS_NOT_SERVICEABLE',
          message: 'This store does not deliver to that address',
        });
      }
    }

    let slot: SlotView | null = null;
    if (input.slotInstanceId) {
      slot = await this.slots.findSlot(input.slotInstanceId).catch(() => null);

      if (!slot) {
        blockers.push({
          code: 'SLOT_NOT_FOUND',
          message: 'That delivery slot no longer exists',
        });
      } else if (cart.branchId && slot.branchId !== cart.branchId) {
        blockers.push({
          code: 'SLOT_WRONG_VENDOR',
          message: 'That slot belongs to a different store',
        });
      } else if (!slot.isBookable) {
        blockers.push({
          code: `SLOT_${slot.status}`,
          message: 'That delivery slot can no longer be booked',
        });
      }
    } else {
      blockers.push({ code: 'SLOT_REQUIRED', message: 'Choose a delivery slot' });
    }

    // Scored on the address the customer actually chose, because a blocked
    // pincode is a property of where it is going, not of who is buying.
    const cod = address
      ? await this.codFlow.assess({
          accountId,
          orderTotalPaise: cart.totals.grandTotalPaise,
          addressPincode: address.pincode,
          paymentMethod: PaymentMethod.COD,
        })
      : null;

    return {
      cart,
      address: address
        ? {
            id: address.id,
            recipientName: address.recipientName,
            line1: address.line1,
            city: address.city,
            pincode: address.pincode,
          }
        : null,
      slot,
      totals: cart.totals,
      blockers,
      cod: {
        available: cod?.allowed ?? true,
        reasons: cod && !cod.allowed ? cod.reasons : [],
        confirmation: cod?.method ?? 'NONE',
      },
    };
  }

  /**
   * Places the order.
   *
   * ## One transaction
   *
   * Booking the slot, writing the order and closing the cart happen together or
   * not at all. Each failure the other way round is a real support case: a slot
   * held for an order nobody wrote is capacity nobody can use, and a cart still
   * open after an order is placed is a second order the customer never meant.
   *
   * ## Priced here, not from the preview
   *
   * The totals are recomputed from the live cart at the moment of writing. A
   * client that sends back the number it was shown is a client that can be
   * asked to send a smaller one.
   */
  async place(accountId: string, input: PlaceOrderInput) {
    const method = (input.paymentMethod ?? PaymentMethod.COD) as PaymentMethod;

    // Cards and wallets are fast-follow (§2.10.1): the gateway supports them,
    // but nothing downstream — refunds, settlement, chargebacks — is built for
    // them yet. Refusing plainly beats taking money we cannot service.
    if (method === PaymentMethod.CARD || method === PaymentMethod.WALLET) {
      throw new BadRequestException(
        'Only UPI and cash on delivery are available right now',
      );
    }

    const activeCart = await this.carts.findActive({ accountId });
    if (activeCart) {
      // Cheap path: the order is already written and the cart has not been
      // closed yet. Returns the first order rather than making a second.
      const existing = await this.orders.findByCart(activeCart.id);
      if (existing) return this.orders.findForAccount(accountId, existing.id);
    }

    const preview = await this.preview(accountId, input);
    if (preview.blockers.length > 0) {
      throw new ConflictException({
        message: 'This order cannot be placed yet',
        code: 'CHECKOUT_BLOCKED',
        blockers: preview.blockers,
      });
    }

    const cart = preview.cart;
    const address = await this.addresses.get(accountId, preview.address!.id);
    const slot = preview.slot!;

    if (!activeCart) throw new NotFoundException('No active basket');

    const substitutionPreference =
      input.substitutionPreference ??
      cart.substitutionPreference ??
      SubstitutionPreference.AUTO_SUBSTITUTE;

    /*
     * How much to trust this cash order (§2.10.4).
     *
     * Before the write, because the answer decides the order's opening status
     * and AWAITING_VENDOR cannot be walked back. Deterministic rules mean this
     * agrees with what the preview already told the customer.
     */
    const codAssessment = await this.codFlow.assess({
      accountId,
      orderTotalPaise: cart.totals.grandTotalPaise,
      addressPincode: address.pincode,
      paymentMethod: method,
    });

    if (!codAssessment.allowed) {
      throw new ConflictException({
        message: 'Cash on delivery is not available for this order',
        code: 'COD_NOT_AVAILABLE',
        reasons: codAssessment.reasons,
      });
    }

    const { orderId, intent } = await this.writeOrder(accountId, {
      cart,
      cartId: activeCart.id,
      address,
      slot,
      substitutionPreference,
      method,
      requiresCodConfirmation: codAssessment.method !== 'NONE',
    });

    // Only once the money is certain. Telling a store to start packing a
    // prepaid order before the gateway confirms is how a failed payment
    // becomes a shop's loss — for prepaid the announcement happens at capture.
    if (!needsGateway(method)) {
      // Cash is not certain merely because it was chosen: §2.10.4 asks how much
      // this order should be trusted, and a risky one waits for the customer to
      // vouch for it before any shop starts packing.
      const { releasedToVendor } = await this.codFlow.onPlaced(orderId, codAssessment);

      if (releasedToVendor) {
        // Outside the transaction, deliberately. A messaging outage must not
        // undo an order: the store not hearing about it is recoverable — the
        // §1.9.4 sweep chases it — while an order that does not exist is not.
        void this.vendorFlow.announceNewOrder(orderId);
      }
    }

    const order = await this.orders.findForAccount(accountId, orderId);
    return intent ? { ...order, payment: intent } : order;
  }

  /**
   * The atomic part: book, write, close.
   *
   * The unique index on `cart_id` is what actually prevents a duplicate order,
   * not the check above it — two submissions in flight together both see an
   * open cart and both get here. The loser's insert violates the index, its
   * whole transaction rolls back (releasing the slot place it took), and it
   * returns the winner's order. Without that, a double tap produces two orders
   * and two places held in a slot that only ever needed one.
   */
  /**
   * Holds stock for every line, or refuses the order.
   *
   * The refusal is a 409 naming the item, because "something went wrong" on a
   * checkout screen is indistinguishable from a bug — and this is the most
   * ordinary thing that can happen to a shop with three packets left.
   *
   * The idempotency key is derived from the cart line rather than generated, so
   * a retried checkout reuses the same key and cannot take a second unit
   * (rule R4). Two attempts at the same basket are the same intent.
   */
  private async reserveEveryLine(
    cart: CartView,
    orderId: string,
    cartId: string,
    accountId: string,
    method: PaymentMethod,
    tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  ): Promise<void> {
    for (const line of cart.lines) {
      const result = await this.inventory.reserve(
        {
          vendorOfferId: line.vendorOfferId,
          quantity: line.quantity,
          idempotencyKey: `cart:${cartId}:line:${line.id}`,
          orderId,
          accountId,
          ttlMinutes: reservationTtlMinutes(method),
        },
        tx,
      );

      if (result.outcome === ReservationOutcome.INSUFFICIENT_STOCK) {
        throw new ConflictException({
          message: `${line.name} just sold out. Remove it to continue.`,
          code: 'INSUFFICIENT_STOCK',
          vendorOfferId: line.vendorOfferId,
          name: line.name,
        });
      }
    }
  }

  private async writeOrder(
    accountId: string,
    context: {
      cart: CartView;
      cartId: string;
      address: Awaited<ReturnType<AddressService['get']>>;
      slot: SlotView;
      substitutionPreference: string;
      method: PaymentMethod;
      requiresCodConfirmation: boolean;
    },
  ): Promise<{ orderId: string; intent: PaymentIntent | null }> {
    const { cart, address, slot, substitutionPreference, method } = context;
    const activeCart = { id: context.cartId };

    // Set inside the transaction and read after it: the caller needs the
    // gateway handle to hand to the customer's app.
    let intent: PaymentIntent | null = null;

    try {
      return await this.db
        .transaction(async (tx) => {
          // Throws if the slot filled between the preview and now — which is
          // exactly the race this ordering exists to lose safely, because nothing
          // has been written yet.
          await this.slots.book(slot.id, tx);

          const created = await this.orders.create(
            {
              accountId,
              branchId: cart.branchId!,
              cartId: activeCart.id,
              paymentMethod: method,
              substitutionPreference,
              requiresCodConfirmation: context.requiresCodConfirmation,

              address: {
                id: address.id,
                recipientName: address.recipientName,
                recipientPhone: address.recipientPhone,
                line1: address.line1,
                line2: address.line2,
                landmark: address.landmark,
                city: address.city,
                state: address.state,
                pincode: address.pincode,
                latitude: address.latitude,
                longitude: address.longitude,
                deliveryNote: address.deliveryNote,
              },

              slot: {
                id: slot.id,
                serviceDate: slot.serviceDate,
                startsAt: slot.startsAt,
                endsAt: slot.endsAt,
              },

              totals: {
                itemsSubtotalPaise: cart.totals.subtotalPaise,
                savingsPaise: cart.totals.savingsPaise,
                deliveryFeePaise: cart.totals.deliveryFeePaise,
                smallBasketFeePaise: cart.totals.smallBasketFeePaise,
                packagingFeePaise: cart.totals.packagingFeePaise,
                grandTotalPaise: cart.totals.grandTotalPaise,
              },

              lines: cart.lines.map((line) => ({
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
              })),
            },
            tx,
          );

          // Stock is taken here, at checkout initiation (§2.5) — never at
          // add-to-cart, where one shopper browsing would make an item look out
          // of stock to everybody else.
          //
          // After the order exists so each hold can name it, and inside the same
          // transaction so losing the race for the last packet unwinds the order
          // and the slot with it. A hold kept for an order nobody wrote is stock
          // nobody can sell and nobody can find.
          await this.reserveEveryLine(
            cart,
            created.id,
            activeCart.id,
            accountId,
            method,
            tx,
          );

          // Holds stay provisional while anything is still unsettled, and are
          // settled the moment nothing is. Prepaid waits for the gateway; cash
          // that §2.10.4 wants confirmed waits for the customer. Both are what
          // the TTL and the §2.5 sweeper exist for — an order nobody comes back
          // to returns its stock on its own.
          if (needsGateway(method)) {
            intent = await this.payments.start(
              {
                orderId: created.id,
                accountId,
                amountPaise: cart.totals.grandTotalPaise,
                method,
                orderNumber: created.orderNumber,
                customerPhone: address.recipientPhone,
              },
              tx,
            );
          } else if (!context.requiresCodConfirmation) {
            await this.inventory.confirmForOrder(created.id, tx);
          }

          await this.carts.markConverted(activeCart.id, tx);

          return created.id;
        })
        .then((orderId) => ({ orderId, intent }));
    } catch (error) {
      if (isDuplicateCartOrder(error)) {
        const winner = await this.orders.findByCart(activeCart.id);
        if (winner) return { orderId: winner.id, intent: null };
      }
      throw error;
    }
  }
}

/** Postgres unique violation on the one index that makes placing idempotent. */
function isDuplicateCartOrder(error: unknown): boolean {
  const candidate = error as { code?: string; constraint?: string } | null;
  return candidate?.code === '23505' && candidate?.constraint === 'order_cart_key';
}
