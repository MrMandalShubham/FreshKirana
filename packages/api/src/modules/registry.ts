/**
 * The bounded contexts of spec §2.2.
 *
 * Single source of truth for module names. The boundary checks
 * (`scripts/check-schema-ownership.mjs`) and future extraction tooling read
 * this list, so adding a module means adding it here — not just creating a
 * folder.
 *
 * Each module owns the PostgreSQL schema of the same name. Note that `order`
 * and `user` are SQL reserved words; Drizzle always quotes identifiers so this
 * is safe, but hand-written psql needs `"order".orders`.
 */
export const MODULE_NAMES = [
  'identity',
  'user',
  'branch',
  'catalog',
  'offer',
  'search',
  'pricing',
  'cart',
  'serviceability',
  'checkout',
  'order',
  'inventory',
  'payment',
  'cod',
  'delivery',
  'tax',
  'ledger',
  'settlement',
  'notification',
  'support',
  'analytics',
  'admin',
] as const;

export type ModuleName = (typeof MODULE_NAMES)[number];

/**
 * Modules extracted into their own deployable, per the §2.1.2 triggers.
 * Empty by design: extraction happens on evidence, never by default.
 */
export const EXTRACTED_MODULES: readonly ModuleName[] = [];
