-- Backend-managed btree indexes for table read queries.
-- NULL means no managed query indexes.
ALTER TABLE "table_meta" ADD COLUMN IF NOT EXISTS "query_index_policy" JSONB;
