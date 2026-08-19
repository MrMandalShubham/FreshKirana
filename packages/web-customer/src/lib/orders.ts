import type { CustomerTimeline, SlotStatus } from '@freshkirana/contracts';
import { getPrivateJson } from './api';

/** Shapes the storefront reads. Deliberately a subset of what the API returns. */
export interface CartLine {
  id: string;
  vendorOfferId: string;
  masterProductId: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  netQuantity: number;
  uom: string;
  isVariableWeight: boolean;
  quantityMode: string;
  quantityStep: number;
  quantity: number;
  unitPricePaise: number;
  mrpPaise: number;
  lineTotalPaise: number;
  priceChanged: boolean;
  isAvailable: boolean;
}

export interface CartTotals {
  subtotalPaise: number;
  savingsPaise: number;
  deliveryFeePaise: number;
  smallBasketFeePaise: number;
  packagingFeePaise: number;
  grandTotalPaise: number;
  amountToFreeDeliveryPaise: number;
  amountToMinimumOrderPaise: number;
  meetsMinimumOrder: boolean;
}

export interface Cart {
  id: string;
  vendorId: string | null;
  substitutionPreference: string;
  lines: CartLine[];
  totals: CartTotals;
  unavailableLineIds: string[];
}

export interface Address {
  id: string;
  label: string;
  recipientName: string;
  recipientPhone: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  state: string;
  pincode: string;
  latitude: number;
  longitude: number;
  isDefault: boolean;
}

export interface Slot {
  id: string;
  vendorId: string;
  serviceDate: string;
  startsAt: string;
  endsAt: string;
  label: string;
  remaining: number;
  status: SlotStatus;
  isBookable: boolean;
}

export interface CheckoutBlocker {
  code: string;
  message: string;
}

export interface CheckoutPreview {
  cart: Cart;
  address: { id: string; recipientName: string; line1: string; pincode: string } | null;
  slot: Slot | null;
  totals: CartTotals;
  blockers: CheckoutBlocker[];
}

export interface OrderLine {
  id: string;
  name: string;
  quantity: number;
  uom: string;
  netQuantity: number;
  isVariableWeight: boolean;
  unitPricePaise: number;
  lineTotalPaise: number;
  status: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  status: string;
  label: string | null;
  paymentMethod: string;
  paymentStatus: string;
  placedAt: string;
  slotStartsAt: string;
  slotEndsAt: string;
  recipientName: string;
  addressLine1: string;
  addressCity: string;
  addressPincode: string;
  itemsSubtotalPaise: number;
  deliveryFeePaise: number;
  smallBasketFeePaise: number;
  packagingFeePaise: number;
  grandTotalPaise: number;
  codCollectablePaise: number;
  lines: OrderLine[];
  nextActions: Array<{ to: string; requiresReason: boolean }>;
}

export interface OrderDetail extends Order {
  timeline: CustomerTimeline;
  history: Array<{ toStatus: string; reason: string | null; createdAt: string }>;
}

export interface UsualBasketItem {
  masterProductId: string;
  vendorOfferId: string;
  vendorId: string;
  name: string;
  quantity: number;
  netQuantity: number;
  uom: string;
  purchaseCount: number;
  medianIntervalDays: number | null;
  daysSinceLastPurchase: number;
  confidence: number;
}

export interface BuyAgainItem {
  masterProductId: string;
  vendorOfferId: string;
  name: string;
  slug: string;
  netQuantity: number;
  uom: string;
  quantity: number;
  timesOrdered: number;
  lastOrderedAt: string;
}

export interface InboxItem {
  id: string;
  template: string;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
  orderId: string | null;
}

/**
 * The basket.
 *
 * Never throws: an unreachable API on the cart screen should show an empty
 * basket with an error, not an error page over the whole shop.
 */
export async function fetchCart(): Promise<Cart | null> {
  const result = await getPrivateJson<Cart>('/cart');
  return result.data;
}

export async function fetchAddresses(): Promise<Address[]> {
  const result = await getPrivateJson<Address[]>('/me/addresses');
  return result.data ?? [];
}

export async function fetchSlots(vendorId: string): Promise<Slot[]> {
  const result = await getPrivateJson<Slot[]>(
    `/serviceability/stores/${encodeURIComponent(vendorId)}/slots?days=3`,
  );
  return result.data ?? [];
}

export async function fetchCheckoutPreview(params: {
  addressId?: string;
  slotInstanceId?: string;
}): Promise<CheckoutPreview | null> {
  const query = new URLSearchParams();
  if (params.addressId) query.set('addressId', params.addressId);
  if (params.slotInstanceId) query.set('slotInstanceId', params.slotInstanceId);

  const suffix = query.toString() ? `?${query.toString()}` : '';
  const result = await getPrivateJson<CheckoutPreview>(`/checkout/preview${suffix}`);
  return result.data;
}

export async function fetchOrders(): Promise<Order[]> {
  const result = await getPrivateJson<Order[]>('/me/orders?limit=20');
  return result.data ?? [];
}

export async function fetchOrder(orderId: string): Promise<OrderDetail | null> {
  const result = await getPrivateJson<OrderDetail>(
    `/me/orders/${encodeURIComponent(orderId)}`,
  );
  return result.data;
}

/**
 * The predicted basket (§0.3).
 *
 * Empty for anyone not signed in, and for anyone without a history — a new
 * customer has no usual basket, and inventing one would be worse than an
 * honest absence.
 */
export async function fetchUsualBasket(): Promise<UsualBasketItem[]> {
  const result = await getPrivateJson<{ items: UsualBasketItem[] }>('/me/usual-basket');
  return result.data?.items ?? [];
}

export async function fetchBuyAgain(): Promise<BuyAgainItem[]> {
  const result = await getPrivateJson<BuyAgainItem[]>('/me/buy-again');
  return result.data ?? [];
}

export async function fetchInbox(): Promise<{ items: InboxItem[]; unread: number }> {
  const result = await getPrivateJson<{ items: InboxItem[]; unread: number }>(
    '/me/notifications?limit=30',
  );
  return result.data ?? { items: [], unread: 0 };
}
