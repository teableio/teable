-- CreateTable
CREATE TABLE "computed_field_activity" (
    "field_id" TEXT NOT NULL,
    "table_id" TEXT NOT NULL,
    "base_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "active_task_count" INTEGER NOT NULL DEFAULT 0,
    "processing_task_count" INTEGER NOT NULL DEFAULT 0,
    "generation" BIGINT NOT NULL DEFAULT 0,
    "estimated_complexity" BIGINT NOT NULL DEFAULT 0,
    "estimated_dirty_records" BIGINT NOT NULL DEFAULT 0,
    "has_all_target_records" BOOLEAN NOT NULL DEFAULT false,
    "queued_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "last_completed_at" TIMESTAMP(3),
    "last_duration_ms" INTEGER,
    "last_error" JSONB,
    "extensions" JSONB,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "computed_field_activity_pkey" PRIMARY KEY ("field_id")
);

-- CreateTable
CREATE TABLE "computed_table_activity" (
    "table_id" TEXT NOT NULL,
    "base_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "calculating_field_count" INTEGER NOT NULL DEFAULT 0,
    "queued_field_count" INTEGER NOT NULL DEFAULT 0,
    "estimated_complexity" BIGINT NOT NULL DEFAULT 0,
    "recent_completions" JSONB NOT NULL DEFAULT '[]',
    "generation" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "computed_table_activity_pkey" PRIMARY KEY ("table_id")
);

-- CreateTable
CREATE TABLE "computed_task_field_ref" (
    "task_id" TEXT NOT NULL,
    "field_id" TEXT NOT NULL,
    "table_id" TEXT NOT NULL,
    "base_id" TEXT NOT NULL,
    "was_processing" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "computed_task_field_ref_pkey" PRIMARY KEY ("task_id","field_id")
);

-- CreateIndex
CREATE INDEX "computed_field_activity_table_id_status_idx" ON "computed_field_activity"("table_id", "status");

-- CreateIndex
CREATE INDEX "computed_field_activity_base_id_status_idx" ON "computed_field_activity"("base_id", "status");

-- CreateIndex
CREATE INDEX "computed_table_activity_base_id_status_idx" ON "computed_table_activity"("base_id", "status");

-- CreateIndex
CREATE INDEX "computed_task_field_ref_field_id_idx" ON "computed_task_field_ref"("field_id");
