-- Custom migration: trigram search support for duplicate detection (spec §2.4.1).
--
-- Drizzle does not model extensions or operator-class indexes, so this is
-- hand-written. Both objects are IF NOT EXISTS / concurrently-safe to re-run,
-- because CI applies migrations twice to prove idempotency.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint

-- Without this index, every duplicate check is a sequential scan over the whole
-- master catalog. At the tens of thousands of products C1 anticipates, that
-- turns each CSV row into a table scan and the import crawls.
CREATE INDEX IF NOT EXISTS master_product_name_trgm_idx
  ON catalog.master_product
  USING gin (name gin_trgm_ops);
