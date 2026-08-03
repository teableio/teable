-- CreateIndex
CREATE INDEX "record_trash_table_id_record_id_idx" ON "record_trash"("table_id", "record_id");

-- CreateIndex
CREATE INDEX "table_trash_table_id_idx" ON "table_trash"("table_id");
