-- Retention cleanup deletes notifications by age in small batches; without this
-- index every batch scans the whole table. The table is small in rows (wide in
-- TOAST), so the plain build only blocks notification writes briefly.
CREATE INDEX IF NOT EXISTS "notification_created_time_idx" ON "notification"("created_time");
