-- Persist the producing worker lane; unlabelled historical tasks belong to production.
-- A constant default avoids a table rewrite on PostgreSQL 11+; no task data is copied.
-- Keep the existing pending unique index and four-column ON CONFLICT target:
-- lane-aware writers namespace non-production plan hashes instead. Legacy writers
-- still insert production tasks, but legacy workers do not filter worker_lane.
-- Migrate the main database and every tenant internal schema, then upgrade all
-- production workers before enabling non-production lanes on a shared database.
-- Index creation takes a write-blocking lock on the outbox.
BEGIN;

ALTER TABLE "computed_update_outbox"
    ADD COLUMN IF NOT EXISTS "worker_lane" TEXT NOT NULL DEFAULT 'production';

ALTER TABLE "computed_update_dead_letter"
    ADD COLUMN IF NOT EXISTS "worker_lane" TEXT NOT NULL DEFAULT 'production';

CREATE INDEX IF NOT EXISTS "computed_update_outbox_worker_lane_status_next_run_at_idx"
    ON "computed_update_outbox"("worker_lane", "status", "next_run_at");

COMMIT;
