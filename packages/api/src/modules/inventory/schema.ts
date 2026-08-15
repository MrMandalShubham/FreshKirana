import { pgSchema } from 'drizzle-orm/pg-core';

/**
 * Tables owned by the inventory module.
 *
 * No other module may read or write these. Enforced by
 * scripts/check-schema-ownership.mjs and dependency-cruiser.
 */
export const inventorySchema = pgSchema('inventory');
