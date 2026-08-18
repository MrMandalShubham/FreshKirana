-- Custom migration: trigram index on the search projection (spec §2.7).
--
-- Every query runs `similarity(search_text, term)` and `search_text LIKE
-- '%term%'` across the whole index. Both are sequential scans without a GIN
-- trigram index, so this is what keeps search inside the §1.4.2 budget of
-- p95 < 200 ms as the catalog grows.
--
-- IF NOT EXISTS because CI applies migrations twice to prove idempotency.

CREATE INDEX IF NOT EXISTS product_index_search_text_trgm_idx
  ON search.product_index
  USING gin (search_text gin_trgm_ops);
--> statement-breakpoint

-- Backs the zero-result "did you mean" lookup, which matches on name alone
-- rather than the full search text.
CREATE INDEX IF NOT EXISTS product_index_name_trgm_idx
  ON search.product_index
  USING gin (name gin_trgm_ops);
