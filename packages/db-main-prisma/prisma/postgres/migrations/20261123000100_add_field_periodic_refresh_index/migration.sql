-- Keep field writes available while indexing existing field metadata.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "field_periodic_refresh_idx" ON "field"("table_id") WHERE "needs_periodic_refresh" = true AND "deleted_time" IS NULL;
