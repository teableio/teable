-- CreateEnum
CREATE TYPE "BaseDataDbMoveJobState" AS ENUM (
  'pending',
  'waiting_worker',
  'copying_base_schema',
  'copying_shared_rows',
  'validating',
  'switching',
  'succeeded',
  'failed',
  'cancelled'
);

-- CreateTable
CREATE TABLE "base_data_db_move_job" (
    "id" TEXT NOT NULL,
    "base_id" TEXT NOT NULL,
    "source_space_id" TEXT NOT NULL,
    "target_space_id" TEXT NOT NULL,
    "source_connection_id" TEXT,
    "target_connection_id" TEXT,
    "state" "BaseDataDbMoveJobState" NOT NULL DEFAULT 'pending',
    "inventory" JSONB,
    "copy_stats" JSONB,
    "validation_stats" JSONB,
    "last_error" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "created_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_modified_time" TIMESTAMP(3),

    CONSTRAINT "base_data_db_move_job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "base_data_db_move_job_base_id_state_idx" ON "base_data_db_move_job"("base_id", "state");

-- CreateIndex
CREATE INDEX "base_data_db_move_job_state_idx" ON "base_data_db_move_job"("state");

-- CreateIndex
CREATE INDEX "base_data_db_move_job_source_space_id_state_idx" ON "base_data_db_move_job"("source_space_id", "state");

-- CreateIndex
CREATE INDEX "base_data_db_move_job_target_space_id_state_idx" ON "base_data_db_move_job"("target_space_id", "state");

-- AddForeignKey
ALTER TABLE "base_data_db_move_job" ADD CONSTRAINT "base_data_db_move_job_base_id_fkey" FOREIGN KEY ("base_id") REFERENCES "base"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "base_data_db_move_job" ADD CONSTRAINT "base_data_db_move_job_source_space_id_fkey" FOREIGN KEY ("source_space_id") REFERENCES "space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "base_data_db_move_job" ADD CONSTRAINT "base_data_db_move_job_target_space_id_fkey" FOREIGN KEY ("target_space_id") REFERENCES "space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
