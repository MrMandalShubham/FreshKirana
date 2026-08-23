/**
 * UI translations (spec §4.1).
 *
 * A plain object rather than an i18n library: the shell needs about forty
 * strings, and a runtime i18n framework would cost more of the §4.1 bundle
 * budget than the strings themselves.
 */

export const LOCALES = ['en'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

export const LOCALE_LABEL: Record<Locale, string> = {
  en: 'English',
};

const en = {
  appName: 'FreshKirana',
  searchPlaceholder: 'Search for atta, rice, oil…',
  search: 'Search',
  home: 'Home',
  categories: 'Categories',
  cart: 'Cart',
  orders: 'Orders',
  account: 'Account',
  buyAgain: 'Buy again',
  usualBasket: 'Your usual basket',
  usualBasketSub: '{count} items you buy regularly, ready to go',
  shopByCategory: 'Shop by category',
  outOfStock: 'Out of stock',
  inStock: 'In stock',
  addToCart: 'Add',
  noResults: 'Nothing matched',
  noResultsHint: 'Try a different spelling, or browse a category.',
  didYouMean: 'Did you mean',
  resultsFor: 'Results for',
  browseCategory: 'Browse',
  productDetails: 'Product details',
  netQuantity: 'Net quantity',
  manufacturer: 'Manufacturer / packer',
  countryOfOrigin: 'Country of origin',
  consumerCare: 'Consumer care',
  hsnCode: 'HSN code',
  veg: 'Veg',
  nonVeg: 'Non-veg',
  egg: 'Contains egg',
  variableWeightNotice:
    'Priced by weight. The final price varies with the actual weight delivered.',
  sellers: 'sellers',
  seller: 'seller',
  from: 'from',
  perUnit: 'per',
  save: 'Save',
  emptyCategory: 'No products here yet.',
  comingSoon: 'Coming soon',
  backToHome: 'Back to home',
  appearance: 'Appearance',
  themeLight: 'Light',
  themeDark: 'Dark',
  themeFollowingPhone: 'Following your phone',
  notFound: 'We could not find that page.',

  // --- Basket and checkout (P2.6) ---
  adding: 'Adding…',
  addedToCart: 'Added',
  differentStore:
    'Your basket is from another shop. One order comes from one store — empty the basket to shop here.',
  emptyCart: 'Your basket is empty.',
  startShopping: 'Start shopping',
  remove: 'Remove',
  increase: 'Increase quantity',
  decrease: 'Reduce quantity',
  itemUnavailable: 'The shop has run out of this. Remove it to continue.',
  priceChanged: 'The price changed since you added this.',
  orderSummary: 'Order summary',
  itemsTotal: 'Items',
  youSave: 'You save',
  deliveryFee: 'Delivery',
  smallBasketFee: 'Small basket fee',
  packagingFee: 'Packaging',
  toPay: 'To pay',
  free: 'Free',
  addMoreForMinimum: 'Add {amount} more to avoid the small basket fee.',
  addMoreForFreeDelivery: 'Add {amount} more for free delivery.',
  checkout: 'Checkout',
  signInToCheckout: 'Sign in to check out',
  deliveryAddress: 'Delivery address',
  deliverySlot: 'Delivery slot',
  noSlots: 'This shop has no delivery slots open right now.',
  slotFull: 'Full',
  slotClosed: 'Shop closed',
  slotCutoffPassed: 'Too late for this slot',
  ifSomethingIsOut: 'If something is out of stock',
  substituteAuto: 'Send a similar item',
  substituteAsk: 'Ask me first',
  substituteRefund: 'Skip it and refund me',
  payment: 'Payment',
  codOnly: 'Cash on delivery. Online payment is coming soon.',
  payOnDelivery: 'Pay on delivery',
  totalPaid: 'Total',
  placeOrder: 'Place order',
  placingOrder: 'Placing…',
  noAddresses: 'Add the address this order should go to.',
  recipientName: 'Name',
  phone: 'Phone',
  addressLine: 'House and street',
  landmark: 'Landmark',
  city: 'City',
  state: 'State',
  pincode: 'PIN code',
  latitude: 'Latitude',
  longitude: 'Longitude',
  saveAddress: 'Save address',
  saving: 'Saving…',

  // --- Orders (P2.6) ---
  noOrders: 'No orders yet.',
  item: 'item',
  items: 'Items',
  allOrders: 'All orders',
  cancelOrder: 'Cancel this order',
  cancelReason: 'Why are you cancelling? (optional)',
  confirmCancel: 'Yes, cancel it',
  keepOrder: 'Keep the order',
  cancelling: 'Cancelling…',
  stepPlaced: 'Order placed',
  stepConfirmed: 'Shop confirmed',
  stepPacking: 'Being packed',
  stepOnTheWay: 'On the way',
  stepDelivered: 'Delivered',
  stepDone: 'Done',
  stepNow: 'Happening now',
  stepUpcoming: 'Still to come',
  stepNotReached: 'Did not happen',
  notifications: 'Updates',
  noNotifications: 'No updates yet.',

  // --- Session (P2.6) ---
  signIn: 'Sign in',
  signOut: 'Sign out',
  devSignInNotice:
    'Real sign-in with an OTP is not built yet. This continues as a test customer.',
  continueAsTestCustomer: 'Continue as a test customer',
  signInUnavailable: 'Sign-in is not available in this environment yet.',

  // --- Usual basket and buy again (P2.7) ---
  addAllToCart: 'Add all {count} to basket',
  someItemsSkipped:
    '{count} could not be added — the shop is out, or stocks them elsewhere.',
  usuallyEvery: 'Usually every {interval} days · last bought {days} days ago',
  boughtBefore: 'Bought {days} days ago',
  boughtTimes: 'bought {count} times',

  // --- Payment recovery (P3.3) ---
  paymentNotDone: 'Payment not completed',
  paymentNotDoneHelp:
    'Your basket and delivery slot are still held. Finish paying to confirm the order.',
  payAgain: 'Try paying again',
  payingAgain: 'Opening payment…',
  payWithCash: 'Pay cash on delivery instead',
  switchingToCash: 'Switching…',
  cashNotAvailable: 'Cash on delivery is not available for this order.',
  payNow: 'Pay {amount}',
  paymentLinkDead: 'This payment link has expired.',
  paymentLinkDeadHelp:
    'Open the order in the app to try again. If nothing is paid, the order is cancelled and your basket released.',
  paymentAmount: 'Amount to pay',
  paymentGatewayMissing:
    'Online payment is not configured in this environment yet, so this link cannot open a payment app.',
  paymentOpening: 'Opening your payment app…',
  paymentClosed: 'Payment was not completed. You can try again.',
  paymentTakingEffect:
    'Payment received. Confirming your order — this takes a few seconds.',
  backToOrder: 'View the order',

  // --- Cash on delivery confirmation (P3.4) ---
  codConfirmTitle: 'Confirm your cash order',
  codConfirmHelp:
    'Your items and delivery slot are held. The shop starts packing once you confirm.',
  codConfirmYes: 'Yes, I will take it',
  codConfirmNo: 'Cancel this order',
  codConfirming: 'Confirming…',
  codCancelling: 'Cancelling…',
  codOtpHelp: 'We sent a {length}-digit code to {phone}. Enter it to confirm this order.',
  codOtpLabel: 'Confirmation code',
  codOtpSubmit: 'Confirm',
  codOtpWrong: 'That code is not right. {left} tries left.',
  codOtpNoTries: 'Too many wrong codes. Please contact support.',
  codOtpExpired: 'This confirmation has expired.',
  codExpiresAt: 'Confirm before {time}',
  codConfirmedNotice: 'Confirmed. The shop has been told.',

  // --- Refunds and cancellations (P3.5) ---
  refunds: 'Refund',
  refundInitiated: 'On its way back',
  refundProcessing: 'With your bank',
  refundCompleted: 'Refunded',
  refundFailed: 'Could not be sent — we are on it',
  refundExpected: 'Expected in {min}–{max} working days',
  refundToOriginal: 'Back to how you paid',
  refundToBank: 'To your bank account',
  refundToStoreCredit: 'As store credit',
  cancelRefundNotice: '{amount} will be refunded.',
  cancelFeeNotice:
    'A cancellation fee of {amount} applies — the shop has already packed this.',
  cancelNothingToRefund: 'Nothing has been charged, so there is nothing to refund.',
  // --- The picker (P4.1) ---
  vendorQueue: 'Orders to do',
  vendorQueueNotice: 'Shop view — the full dashboard is coming later.',
  vendorNoOrders: 'Nothing waiting. New orders appear here and on WhatsApp.',
  vendorAccept: 'Accept this order',
  vendorStartPicking: 'Start picking',
  vendorMarkPacked: 'Packed',
  vendorReadyForPickup: 'Ready for pickup',
  vendorOutOfStock: 'Out of stock',
  vendorMarking: 'Marking…',
  vendorWorking: 'Working…',
  vendorActionFailed: 'That did not go through. Please try again.',
  vendorLineOutOfStock: 'Out of stock — asking the customer',
  vendorLineSubstituted: 'Substituted',
  vendorLineRefunded: 'Refunded',
  vendorCollectCash: 'Collect on delivery',
  vendorPrepaid: 'Already paid',
  vendorBackToQueue: 'Back to orders',
  vendorSignIn: 'Continue as shop staff',

  // --- Weighing (P4.2) ---
  vendorGrams: 'grams',
  vendorSaveWeight: 'Save weight',
  vendorWeighed: 'weighed {grams}g',
  vendorWeightAsked:
    'That is outside the usual range, so we have asked the customer. Their answer decides.',
} as const;

/**
 * Keys are fixed, values are free.
 *
 * The shell ships in English only. This type is what keeps that a decision
 * rather than a dead end: adding a locale means adding one object, and a
 * missing or misspelled key is a compile error rather than a blank label.
 */
type Dictionary = Record<keyof typeof en, string>;

const DICTIONARIES: Record<Locale, Dictionary> = { en };

export function getDictionary(locale: Locale): Dictionary {
  return DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE];
}

export type { Dictionary };

/**
 * Picks the best available translation of a **product** name.
 *
 * With one locale this always falls through to the catalogue name, which is
 * the correct English-only behaviour: Indian staples keep the names people
 * actually use — atta, toor dal, haldi — rather than being translated into
 * "whole wheat flour". Kept because the catalogue still carries `nameI18n`,
 * and a second locale should not need this rewritten.
 */
export function localisedName(
  name: string,
  nameI18n: Record<string, string> | null | undefined,
  locale: Locale,
): string {
  const translated = nameI18n?.[locale]?.trim();
  return translated && translated.length > 0 ? translated : name;
}
