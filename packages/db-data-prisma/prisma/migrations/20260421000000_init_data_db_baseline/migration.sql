-- Data-plane baseline for dual-db mode.
--
-- This migration intentionally contains only the shared objects that should live in the data DB:
-- computed update queue tables, trash/history tables, and v2 undo-capture globals.
-- Keep Prisma-managed table definitions aligned with community/packages/db-data-prisma/prisma/schema.prisma.
-- Keep the raw undo-capture SQL aligned with community/packages/v2/adapter-table-repository-postgres/src/shared/undoCaptureGlobalsSql.ts.

-- CreateTable
CREATE TABLE IF NOT EXISTS "computed_update_outbox" (
    "id" TEXT NOT NULL,
    "base_id" TEXT NOT NULL,
    "seed_table_id" TEXT NOT NULL,
    "seed_record_ids" JSONB,
    "change_type" TEXT NOT NULL,
    "steps" JSONB,
    "edges" JSONB,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 8,
    "next_run_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMP(3),
    "locked_by" TEXT,
    "last_error" TEXT,
    "estimated_complexity" INTEGER NOT NULL DEFAULT 0,
    "plan_hash" TEXT NOT NULL,
    "dirty_stats" JSONB,
    "run_id" TEXT NOT NULL,
    "origin_run_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "run_total_steps" INTEGER NOT NULL DEFAULT 0,
    "run_completed_steps_before" INTEGER NOT NULL DEFAULT 0,
    "affected_table_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "affected_field_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "sync_max_level" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "computed_update_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "computed_update_outbox_seed" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "table_id" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,

    CONSTRAINT "computed_update_outbox_seed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "computed_update_dead_letter" (
    "id" TEXT NOT NULL,
    "base_id" TEXT NOT NULL,
    "seed_table_id" TEXT NOT NULL,
    "seed_record_ids" JSONB,
    "change_type" TEXT NOT NULL,
    "steps" JSONB,
    "edges" JSONB,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 8,
    "next_run_at" TIMESTAMP(3) NOT NULL,
    "locked_at" TIMESTAMP(3),
    "locked_by" TEXT,
    "last_error" TEXT,
    "estimated_complexity" INTEGER NOT NULL DEFAULT 0,
    "plan_hash" TEXT NOT NULL,
    "dirty_stats" JSONB,
    "run_id" TEXT NOT NULL,
    "origin_run_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "run_total_steps" INTEGER NOT NULL DEFAULT 0,
    "run_completed_steps_before" INTEGER NOT NULL DEFAULT 0,
    "affected_table_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "affected_field_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "sync_max_level" INTEGER,
    "trace_data" JSONB,
    "failed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "computed_update_dead_letter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "computed_update_pause_scope" (
    "id" TEXT NOT NULL,
    "scope_type" TEXT NOT NULL,
    "scope_id" TEXT NOT NULL,
    "paused_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paused_by" TEXT,
    "resume_at" TIMESTAMP(3),
    "reason" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "computed_update_pause_scope_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "computed_update_pause_scope_scope_type_check" CHECK ("scope_type" IN ('space', 'base', 'table'))
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "record_history" (
    "id" TEXT NOT NULL,
    "table_id" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "field_id" TEXT NOT NULL,
    "before" TEXT NOT NULL,
    "after" TEXT NOT NULL,
    "created_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "record_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "table_trash" (
    "id" TEXT NOT NULL,
    "table_id" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "snapshot" TEXT NOT NULL,
    "created_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "table_trash_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "record_trash" (
    "id" TEXT NOT NULL,
    "table_id" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "snapshot" TEXT NOT NULL,
    "created_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "record_trash_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "computed_update_outbox_status_next_run_at_idx" ON "computed_update_outbox"("status", "next_run_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "computed_update_outbox_base_id_seed_table_id_idx" ON "computed_update_outbox"("base_id", "seed_table_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "computed_update_outbox_plan_hash_idx" ON "computed_update_outbox"("plan_hash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "computed_update_outbox_run_id_idx" ON "computed_update_outbox"("run_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "computed_update_outbox_pending_unique_idx" ON "computed_update_outbox"("base_id", "seed_table_id", "plan_hash", "change_type") WHERE "status" = 'pending';

-- CreateIndex
CREATE INDEX IF NOT EXISTS "computed_update_outbox_seed_task_id_idx" ON "computed_update_outbox_seed"("task_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "computed_update_outbox_seed_task_id_table_id_record_id_key" ON "computed_update_outbox_seed"("task_id", "table_id", "record_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "computed_update_dead_letter_base_id_seed_table_id_idx" ON "computed_update_dead_letter"("base_id", "seed_table_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "computed_update_dead_letter_plan_hash_idx" ON "computed_update_dead_letter"("plan_hash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "computed_update_dead_letter_run_id_idx" ON "computed_update_dead_letter"("run_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "computed_update_pause_scope_scope_type_scope_id_key" ON "computed_update_pause_scope"("scope_type", "scope_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "computed_update_pause_scope_resume_at_idx" ON "computed_update_pause_scope"("resume_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "record_history_table_id_record_id_created_time_idx" ON "record_history"("table_id", "record_id", "created_time");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "record_history_table_id_created_time_idx" ON "record_history"("table_id", "created_time");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "table_trash_table_id_idx" ON "table_trash"("table_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "record_trash_table_id_record_id_idx" ON "record_trash"("table_id", "record_id");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'computed_update_outbox_seed_task_id_fkey'
  ) THEN
    ALTER TABLE "computed_update_outbox_seed"
    ADD CONSTRAINT "computed_update_outbox_seed_task_id_fkey"
    FOREIGN KEY ("task_id")
    REFERENCES "computed_update_outbox"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
  END IF;
END;
$$;

-- Global infrastructure for v2 record mutation snapshot capture.
--
-- Dynamic business tables still install their own "__teable_undo_capture" trigger at runtime,
-- but the shared log table and trigger function are part of the data DB baseline.

CREATE TABLE IF NOT EXISTS "public"."__undo_log" (
  "id" BIGSERIAL PRIMARY KEY,
  "batch_id" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "table_name" TEXT NOT NULL,
  "record_id" TEXT NOT NULL,
  "old_row" JSONB,
  "new_row" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "__undo_log_batch_id_idx"
ON "public"."__undo_log" ("batch_id");

ALTER TABLE "public"."__undo_log" SET (
  autovacuum_vacuum_scale_factor = 0.01,
  autovacuum_vacuum_threshold = 100
);

ALTER SEQUENCE IF EXISTS "public"."__undo_log_id_seq"
CACHE 100;

CREATE OR REPLACE FUNCTION "public"."__teable_capture_undo_row"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  batch_id text;
  captured_record_id text;
  captured_old_row jsonb;
  captured_new_row jsonb;
BEGIN
  batch_id := current_setting('teable.undo_batch_id', true);

  IF TG_OP = 'INSERT' THEN
    captured_record_id := COALESCE(NEW."__id"::text, '');
    captured_new_row := to_jsonb(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    captured_record_id := COALESCE(NEW."__id"::text, OLD."__id"::text, '');
    captured_old_row := to_jsonb(OLD);
    captured_new_row := to_jsonb(NEW);
  ELSIF TG_OP = 'DELETE' THEN
    captured_record_id := COALESCE(OLD."__id"::text, '');
    captured_old_row := to_jsonb(OLD);
  END IF;

  IF batch_id IS NULL OR batch_id = '' THEN
    RETURN NULL;
  END IF;

  INSERT INTO "public"."__undo_log" (
    "batch_id",
    "operation",
    "table_name",
    "record_id",
    "old_row",
    "new_row"
  )
  VALUES (
    batch_id,
    TG_OP,
    TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME,
    captured_record_id,
    captured_old_row,
    captured_new_row
  );

  RETURN NULL;
END;
$$;
