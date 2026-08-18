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
