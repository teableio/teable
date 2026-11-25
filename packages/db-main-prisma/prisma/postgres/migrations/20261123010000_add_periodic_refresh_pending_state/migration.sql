-- AlterTable: track in-flight async periodic refresh separately from last succeeded range
ALTER TABLE "field_periodic_refresh_state"
ADD COLUMN "pending_task_id" VARCHAR(64),
ADD COLUMN "pending_local_date" VARCHAR(16),
ADD COLUMN "pending_range_hash" VARCHAR(128),
ADD COLUMN "pending_started_at" TIMESTAMPTZ(6);
