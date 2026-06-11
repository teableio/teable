-- Speed up computed outbox polling under backlog pressure.
CREATE INDEX IF NOT EXISTS "computed_update_outbox_pending_claim_idx"
ON "computed_update_outbox"("estimated_complexity", "next_run_at", "created_at", "id")
WHERE "status" = 'pending';

CREATE INDEX IF NOT EXISTS "computed_update_outbox_processing_reclaim_idx"
ON "computed_update_outbox"("locked_at", "created_at", "id")
WHERE "status" = 'processing';

CREATE INDEX IF NOT EXISTS "computed_update_outbox_processing_base_locked_idx"
ON "computed_update_outbox"("base_id", "locked_at")
WHERE "status" = 'processing' AND "locked_at" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "computed_update_outbox_processing_seed_locked_idx"
ON "computed_update_outbox"("base_id", "seed_table_id", "locked_at")
WHERE "status" = 'processing' AND "locked_at" IS NOT NULL;
