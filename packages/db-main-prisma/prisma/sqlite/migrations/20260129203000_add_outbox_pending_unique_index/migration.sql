CREATE UNIQUE INDEX IF NOT EXISTS "computed_update_outbox_pending_unique_idx" ON "computed_update_outbox"("base_id", "seed_table_id", "plan_hash", "change_type") WHERE "status" = 'pending';
