-- CreateTable
CREATE TABLE "computed_update_outbox" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "base_id" TEXT NOT NULL,
    "seed_table_id" TEXT NOT NULL,
    "seed_record_ids" JSON,
    "change_type" TEXT NOT NULL,
    "steps" JSON NOT NULL,
    "edges" JSON NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 8,
    "next_run_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" DATETIME,
    "locked_by" TEXT,
    "last_error" TEXT,
    "estimated_complexity" INTEGER NOT NULL DEFAULT 0,
    "plan_hash" TEXT NOT NULL,
    "dirty_stats" JSON,
    "affected_table_ids" JSON,
    "affected_field_ids" JSON,
    "sync_max_level" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "computed_update_outbox_seed" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "task_id" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    CONSTRAINT "computed_update_outbox_seed_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "computed_update_outbox" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "computed_update_dead_letter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "base_id" TEXT NOT NULL,
    "seed_table_id" TEXT NOT NULL,
    "seed_record_ids" JSON,
    "change_type" TEXT NOT NULL,
    "steps" JSON NOT NULL,
    "edges" JSON NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 8,
    "next_run_at" DATETIME NOT NULL,
    "locked_at" DATETIME,
    "locked_by" TEXT,
    "last_error" TEXT,
    "estimated_complexity" INTEGER NOT NULL DEFAULT 0,
    "plan_hash" TEXT NOT NULL,
    "dirty_stats" JSON,
    "affected_table_ids" JSON,
    "affected_field_ids" JSON,
    "sync_max_level" INTEGER,
    "failed_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL,
    "updated_at" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "computed_update_outbox_status_next_run_at_idx" ON "computed_update_outbox"("status", "next_run_at");

-- CreateIndex
CREATE INDEX "computed_update_outbox_base_id_seed_table_id_idx" ON "computed_update_outbox"("base_id", "seed_table_id");

-- CreateIndex
CREATE INDEX "computed_update_outbox_plan_hash_idx" ON "computed_update_outbox"("plan_hash");

-- CreateIndex
CREATE INDEX "computed_update_outbox_seed_task_id_idx" ON "computed_update_outbox_seed"("task_id");

-- CreateIndex
CREATE UNIQUE INDEX "computed_update_outbox_seed_task_id_record_id_key" ON "computed_update_outbox_seed"("task_id", "record_id");

-- CreateIndex
CREATE INDEX "computed_update_dead_letter_base_id_seed_table_id_idx" ON "computed_update_dead_letter"("base_id", "seed_table_id");

-- CreateIndex
CREATE INDEX "computed_update_dead_letter_plan_hash_idx" ON "computed_update_dead_letter"("plan_hash");
