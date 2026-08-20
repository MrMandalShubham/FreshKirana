/**
 * UI translations (spec §4.1).
 *
 * A plain object rather than an i18n library: the shell needs about forty
 * strings, and a runtime i18n framework would cost more of the §4.1 bundle
 * budget than the strings themselves.
 */

export const LOCALES = ['en', 'hi'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

export const LOCALE_LABEL: Record<Locale, string> = {
  en: 'English',
  hi: 'हिंदी',
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
  language: 'Language',
  backToHome: 'Back to home',
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
} as const;

/**
 * Keys are fixed, values are free.
 *
 * `typeof en` would inherit the literal types from `as const`, so Hindi would
 * have to equal the English strings — which is exactly backwards. This keeps
 * the useful half: a missing or misspelled key is a compile error.
 */
type Dictionary = Record<keyof typeof en, string>;

const hi: Dictionary = {
  appName: 'फ्रेशकिराना',
  searchPlaceholder: 'आटा, चावल, तेल खोजें…',
  search: 'खोजें',
  home: 'होम',
  categories: 'श्रेणियाँ',
  cart: 'कार्ट',
  orders: 'ऑर्डर',
  account: 'खाता',
  buyAgain: 'फिर से खरीदें',
  usualBasket: 'आपकी नियमित टोकरी',
  shopByCategory: 'श्रेणी से खरीदें',
  outOfStock: 'स्टॉक में नहीं',
  inStock: 'स्टॉक में',
  addToCart: 'जोड़ें',
  noResults: 'कुछ नहीं मिला',
  noResultsHint: 'दूसरी वर्तनी आज़माएँ, या कोई श्रेणी देखें।',
  didYouMean: 'क्या आपका मतलब था',
  resultsFor: 'के लिए परिणाम',
  browseCategory: 'देखें',
  productDetails: 'उत्पाद विवरण',
  netQuantity: 'शुद्ध मात्रा',
  manufacturer: 'निर्माता / पैकर',
  countryOfOrigin: 'मूल देश',
  consumerCare: 'उपभोक्ता सेवा',
  hsnCode: 'एचएसएन कोड',
  veg: 'शाकाहारी',
  nonVeg: 'मांसाहारी',
  egg: 'अंडा शामिल',
  variableWeightNotice:
    'वज़न के हिसाब से मूल्य। अंतिम मूल्य वास्तविक वज़न पर निर्भर करेगा।',
  sellers: 'विक्रेता',
  seller: 'विक्रेता',
  from: 'से',
  perUnit: 'प्रति',
  save: 'बचत',
  emptyCategory: 'यहाँ अभी कोई उत्पाद नहीं है।',
  comingSoon: 'जल्द आ रहा है',
  language: 'भाषा',
  backToHome: 'होम पर वापस',
  notFound: 'वह पृष्ठ नहीं मिला।',

  adding: 'जोड़ा जा रहा है…',
  addedToCart: 'जोड़ दिया',
  differentStore:
    'आपकी टोकरी दूसरी दुकान की है। एक ऑर्डर एक ही दुकान से आता है — यहाँ से खरीदने के लिए टोकरी खाली करें।',
  emptyCart: 'आपकी टोकरी खाली है।',
  startShopping: 'खरीदारी शुरू करें',
  remove: 'हटाएँ',
  increase: 'मात्रा बढ़ाएँ',
  decrease: 'मात्रा घटाएँ',
  itemUnavailable: 'दुकान में यह खत्म हो गया है। आगे बढ़ने के लिए हटाएँ।',
  priceChanged: 'जोड़ने के बाद इसका दाम बदल गया है।',
  orderSummary: 'ऑर्डर का ब्यौरा',
  itemsTotal: 'सामान',
  youSave: 'आपकी बचत',
  deliveryFee: 'डिलीवरी',
  smallBasketFee: 'छोटी टोकरी शुल्क',
  packagingFee: 'पैकिंग',
  toPay: 'देय राशि',
  free: 'मुफ़्त',
  addMoreForMinimum: 'छोटी टोकरी शुल्क से बचने के लिए {amount} और जोड़ें।',
  addMoreForFreeDelivery: 'मुफ़्त डिलीवरी के लिए {amount} और जोड़ें।',
  checkout: 'ऑर्डर करें',
  signInToCheckout: 'ऑर्डर के लिए साइन इन करें',
  deliveryAddress: 'डिलीवरी का पता',
  deliverySlot: 'डिलीवरी का समय',
  noSlots: 'इस दुकान का अभी कोई समय उपलब्ध नहीं है।',
  slotFull: 'भर गया',
  slotClosed: 'दुकान बंद',
  slotCutoffPassed: 'इस समय के लिए देर हो गई',
  ifSomethingIsOut: 'अगर कुछ खत्म हो जाए',
  substituteAuto: 'मिलता-जुलता सामान भेज दें',
  substituteAsk: 'पहले मुझसे पूछें',
  substituteRefund: 'छोड़ दें और पैसे लौटाएँ',
  payment: 'भुगतान',
  codOnly: 'डिलीवरी पर नकद। ऑनलाइन भुगतान जल्द आ रहा है।',
  payOnDelivery: 'डिलीवरी पर देना है',
  totalPaid: 'कुल',
  placeOrder: 'ऑर्डर करें',
  placingOrder: 'ऑर्डर हो रहा है…',
  noAddresses: 'यह ऑर्डर जहाँ जाना है वह पता जोड़ें।',
  recipientName: 'नाम',
  phone: 'फ़ोन',
  addressLine: 'मकान और गली',
  landmark: 'पहचान चिह्न',
  city: 'शहर',
  state: 'राज्य',
  pincode: 'पिन कोड',
  latitude: 'अक्षांश',
  longitude: 'देशांतर',
  saveAddress: 'पता सहेजें',
  saving: 'सहेजा जा रहा है…',

  noOrders: 'अभी कोई ऑर्डर नहीं।',
  item: 'सामान',
  items: 'सामान',
  allOrders: 'सारे ऑर्डर',
  cancelOrder: 'यह ऑर्डर रद्द करें',
  cancelReason: 'रद्द करने का कारण? (वैकल्पिक)',
  confirmCancel: 'हाँ, रद्द करें',
  keepOrder: 'ऑर्डर रहने दें',
  cancelling: 'रद्द किया जा रहा है…',
  stepPlaced: 'ऑर्डर हुआ',
  stepConfirmed: 'दुकान ने पक्का किया',
  stepPacking: 'पैक हो रहा है',
  stepOnTheWay: 'रास्ते में',
  stepDelivered: 'पहुँच गया',
  stepDone: 'हो गया',
  stepNow: 'अभी चल रहा है',
  stepUpcoming: 'आगे होना है',
  stepNotReached: 'नहीं हुआ',
  notifications: 'अपडेट',
  noNotifications: 'अभी कोई अपडेट नहीं।',

  signIn: 'साइन इन',
  signOut: 'साइन आउट',
  devSignInNotice:
    'ओटीपी से असली साइन इन अभी नहीं बना है। यह टेस्ट ग्राहक के रूप में आगे बढ़ता है।',
  continueAsTestCustomer: 'टेस्ट ग्राहक के रूप में जारी रखें',
  signInUnavailable: 'इस वातावरण में साइन इन अभी उपलब्ध नहीं है।',

  addAllToCart: 'सभी {count} टोकरी में डालें',
  someItemsSkipped: '{count} नहीं जोड़ पाए — दुकान में खत्म है, या कहीं और मिलता है।',
  usuallyEvery: 'आमतौर पर हर {interval} दिन · पिछली बार {days} दिन पहले',
  boughtBefore: '{days} दिन पहले खरीदा',
  boughtTimes: '{count} बार खरीदा',

  paymentNotDone: 'पेमेंट पूरा नहीं हुआ',
  paymentNotDoneHelp:
    'आपका सामान और डिलीवरी का समय अभी भी रोका हुआ है। ऑर्डर पक्का करने के लिए पेमेंट पूरा करें।',
  payAgain: 'फिर से पेमेंट करें',
  payingAgain: 'पेमेंट खोला जा रहा है…',
  payWithCash: 'इसके बजाय डिलीवरी पर नकद दें',
  switchingToCash: 'बदला जा रहा है…',
  cashNotAvailable: 'इस ऑर्डर पर डिलीवरी पर नकद उपलब्ध नहीं है।',
  payNow: '{amount} दें',
  paymentLinkDead: 'इस पेमेंट लिंक की मियाद खत्म हो गई।',
  paymentLinkDeadHelp:
    'ऐप में ऑर्डर खोलकर फिर कोशिश करें। पेमेंट न होने पर ऑर्डर रद्द हो जाएगा और सामान छोड़ दिया जाएगा।',
  paymentAmount: 'देने की राशि',
  paymentGatewayMissing:
    'इस वातावरण में ऑनलाइन पेमेंट अभी सेट नहीं है, इसलिए यह लिंक पेमेंट ऐप नहीं खोल सकता।',
  paymentOpening: 'आपका पेमेंट ऐप खोला जा रहा है…',
  paymentClosed: 'पेमेंट पूरा नहीं हुआ। आप फिर कोशिश कर सकते हैं।',
  paymentTakingEffect: 'पेमेंट मिल गया। ऑर्डर पक्का हो रहा है — कुछ सेकंड लगेंगे।',
  backToOrder: 'ऑर्डर देखें',

  codConfirmTitle: 'अपना नकद ऑर्डर पक्का करें',
  codConfirmHelp:
    'आपका सामान और डिलीवरी का समय रोका हुआ है। आपके पक्का करते ही दुकान पैक करना शुरू करेगी।',
  codConfirmYes: 'हाँ, मैं लूँगा',
  codConfirmNo: 'यह ऑर्डर रद्द करें',
  codConfirming: 'पक्का किया जा रहा है…',
  codCancelling: 'रद्द किया जा रहा है…',
  codOtpHelp:
    'हमने {phone} पर {length} अंकों का कोड भेजा है। उसे डालकर ऑर्डर पक्का करें।',
  codOtpLabel: 'पुष्टि कोड',
  codOtpSubmit: 'पक्का करें',
  codOtpWrong: 'यह कोड सही नहीं है। {left} कोशिशें बाकी हैं।',
  codOtpNoTries: 'बहुत बार गलत कोड डाला गया। कृपया सहायता से संपर्क करें।',
  codOtpExpired: 'इस पुष्टि की मियाद खत्म हो गई।',
  codExpiresAt: '{time} से पहले पक्का करें',
  codConfirmedNotice: 'पक्का हो गया। दुकान को बता दिया गया है।',

  refunds: 'रिफंड',
  refundInitiated: 'वापस भेजा जा रहा है',
  refundProcessing: 'आपके बैंक के पास',
  refundCompleted: 'वापस हो गया',
  refundFailed: 'भेजा नहीं जा सका — हम देख रहे हैं',
  refundExpected: '{min}–{max} कार्यदिवस में मिलने की उम्मीद',
  refundToOriginal: 'जैसे दिया था वैसे वापस',
  refundToBank: 'आपके बैंक खाते में',
  refundToStoreCredit: 'स्टोर क्रेडिट के रूप में',
  cancelRefundNotice: '{amount} वापस किया जाएगा।',
  cancelFeeNotice: '{amount} रद्दीकरण शुल्क लगेगा — दुकान ने इसे पैक कर दिया है।',
  cancelNothingToRefund: 'कोई पैसा नहीं लिया गया, इसलिए वापस करने को कुछ नहीं है।',
};

const DICTIONARIES: Record<Locale, Dictionary> = { en, hi };

export function getDictionary(locale: Locale): Dictionary {
  return DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE];
}

export type { Dictionary };

/**
 * Picks the best available translation of a **product** name.
 *
 * §4.1 is explicit that product names must translate, not just UI chrome —
 * it is the half teams forget, and the half that matters in grocery. A Hindi
 * speaker reading "आटा" on the packet should not be shown "Whole Wheat Flour".
 */
export function localisedName(
  name: string,
  nameI18n: Record<string, string> | null | undefined,
  locale: Locale,
): string {
  const translated = nameI18n?.[locale]?.trim();
  return translated && translated.length > 0 ? translated : name;
}
