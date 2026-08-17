/**
 * @freshkirana/contracts
 *
 * Shared domain vocabulary for the API and every frontend. Types defined here
 * are the single source of truth: a rename here becomes a compile error
 * everywhere it is wrong, which is the reason the stack is TypeScript (§2.3).
 */

export * as Money from './money';
export type { Paise } from './money';

export * from './analytics';
export * from './catalog';
export * from './order-status';
export * from './payment-status';
export * from './roles';
export * from './uom';
