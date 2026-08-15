import { pgSchema } from 'drizzle-orm/pg-core';

/**
 * Tables owned by the order module.
 *
 * No other module may read or write these. Enforced by
 * scripts/check-schema-ownership.mjs and dependency-cruiser.
 */
export const orderSchema = pgSchema('order');
