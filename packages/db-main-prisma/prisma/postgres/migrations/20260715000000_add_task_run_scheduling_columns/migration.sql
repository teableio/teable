-- AlterTable (idempotent: safe to replay on databases where the columns already exist)
ALTER TABLE "task_run" ADD COLUMN IF NOT EXISTS "base_id" TEXT;
ALTER TABLE "task_run" ADD COLUMN IF NOT EXISTS "depends_on_run_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];
