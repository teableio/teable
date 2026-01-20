-- CreateIndex
CREATE INDEX IF NOT EXISTS "field_table_id_deleted_time_idx" ON "field"("table_id", "deleted_time");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "table_meta_base_id_deleted_time_idx" ON "table_meta"("base_id", "deleted_time");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "view_table_id_deleted_time_idx" ON "view"("table_id", "deleted_time");

