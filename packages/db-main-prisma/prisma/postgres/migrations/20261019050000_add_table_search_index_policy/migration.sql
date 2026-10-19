-- Backend-managed v1 table search index policy.
-- NULL preserves the legacy behavior: every eligible field participates.
ALTER TABLE "table_meta" ADD COLUMN IF NOT EXISTS "search_index_policy" JSONB;
