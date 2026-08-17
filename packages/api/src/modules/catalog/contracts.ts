/**
 * Public interface of the catalog module.
 *
 * The ONLY file other modules may import from. Every export here is a
 * deliberate widening of this module's public surface (spec §2.1.1).
 *
 * `offer` (P1.2) needs to resolve a master product before attaching price and
 * stock; `search` (P1.4) needs to read them to build its index. Neither may
 * touch the `catalog` schema directly.
 */

export { CatalogService } from './internal/catalog.service';

export type { CategoryRow, BrandRow, MasterProductRow } from './schema';

export {
  ProductStatus,
  type GstRateBp,
  gstRateBpToPercent,
  isValidHsnCode,
  isValidEan,
  missingLegalMetrologyFields,
} from '@freshkirana/contracts';
