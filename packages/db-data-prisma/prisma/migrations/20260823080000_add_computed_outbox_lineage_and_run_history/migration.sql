-- Lineage / latency tracing for computed-update outbox tasks (T6908).
-- Purely additive and idempotent: new nullable/defaulted columns plus a new
-- observability-only ledger table, so it is safe under rolling deploys.

-- AlterTable
ALTER TABLE "computed_update_outbox"
    ADD COLUMN IF NOT EXISTS "source_changed_at" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "stage_depth" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "predecessor_task_id" TEXT;

-- AlterTable
ALTER TABLE "computed_update_dead_letter"
    ADD COLUMN IF NOT EXISTS "source_changed_at" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "stage_depth" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "predecessor_task_id" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "computed_update_run_history" (
    "task_id" TEXT NOT NULL,
    "base_id" TEXT NOT NULL,
    "seed_table_id" TEXT NOT NULL,
    "change_type" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "origin_run_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "steps" JSONB,
    "edges" JSONB,
    "affected_table_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "affected_field_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source_field_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "seed_record_count" INTEGER NOT NULL DEFAULT 0,
    "stage_depth" INTEGER NOT NULL DEFAULT 0,
    "predecessor_task_id" TEXT,
    "run_total_steps" INTEGER NOT NULL DEFAULT 0,
    "run_completed_steps_before" INTEGER NOT NULL DEFAULT 0,
    "sync_max_level" INTEGER,
    "estimated_complexity" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "outcome" TEXT NOT NULL,
    "source_changed_at" TIMESTAMP(3),
    "enqueued_at" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3) NOT NULL,
    "duration_ms" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "computed_update_run_history_pkey" PRIMARY KEY ("task_id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "computed_update_run_history_run_id_idx" ON "computed_update_run_history"("run_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "computed_update_run_history_base_id_completed_at_idx" ON "computed_update_run_history"("base_id", "completed_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "computed_update_run_history_completed_at_idx" ON "computed_update_run_history"("completed_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "computed_update_run_history_origin_run_ids_gin"
    ON "computed_update_run_history" USING GIN ("origin_run_ids");
