-- The validated CHECK lets PostgreSQL (12+) prove the column has no NULLs, so
-- SET NOT NULL skips the table scan and its ACCESS EXCLUSIVE lock is
-- metadata-only and momentary. The CHECK is a stepping stone, dropped here so
-- the schema carries a single mechanism (the column constraint). Idempotent.
ALTER TABLE "task_run" ALTER COLUMN "base_id" SET NOT NULL;
ALTER TABLE "task_run" DROP CONSTRAINT IF EXISTS "task_run_base_id_not_null";
