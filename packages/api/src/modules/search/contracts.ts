/**
 * Public interface of the search module.
 *
 * The ONLY file other modules may import from. Every export here is a
 * deliberate widening of this module's public surface (spec §2.1.1).
 *
 * `SearchIndexService` is exported so the admin module can reindex after a bulk
 * catalog import, and so that catalog and offer writes can trigger a sync
 * without either module depending on search.
 */

export { SearchService } from './internal/search.service';
export { SearchIndexService } from './internal/search-index.service';
export { SynonymService, SynonymKind } from './internal/synonym.service';

export type { SynonymRow, ProductIndexRow } from './schema';

export type {
  SearchResponse,
  SearchResultItem,
  MatchReason,
} from '@freshkirana/contracts';
