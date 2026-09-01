-- Drop pre-cutover task_run rows (T5401): rows created before the
-- per-generation scheduling pipeline never carry base_id, and with the cutover
-- converter removed they are invisible to every runtime path; terminal rows
-- have no readers anywhere in the product.
--
-- Tasks still holding active unattributed runs are cancelled together with ALL
-- of their remaining active runs: the cutover-era watchdog backfilled base_id
-- in bounded batches, so one task can hold unattributed rows AND attributed
-- siblings whose queue jobs are still live — cancelling the runs is what makes
-- the worker's entry guard reject those jobs instead of executing (and
-- billing) a cancelled task. Both cancels run as ONE statement so they are
-- atomic and the affected task set is materialized from a single snapshot.
--
-- The NOT NULL constraint lands across the two follow-up migrations (VALIDATE
-- under a lock that admits concurrent reads/writes, then a scan-free SET NOT
-- NULL) so no statement scans the table under ACCESS EXCLUSIVE while old pods
-- are still serving. Every statement is idempotent — a partially applied
-- deploy converges on re-run.
WITH "affected" AS (
  SELECT DISTINCT "task_id" FROM "task_run"
  WHERE "base_id" IS NULL
    AND "status" IN ('pending', 'queued', 'processing')
),
"cancelled_tasks" AS (
  UPDATE "task"
  SET "status" = 'cancelled',
      "last_modified_time" = CURRENT_TIMESTAMP
  WHERE "status" IN ('pending', 'processing')
    AND "id" IN (SELECT "task_id" FROM "affected")
  RETURNING "id"
)
UPDATE "task_run"
SET "status" = 'cancelled',
    "error_msg" = 'Cancelled: this run predates the current release and was cancelled during upgrade — please re-trigger',
    "last_modified_time" = CURRENT_TIMESTAMP
WHERE "status" IN ('pending', 'queued', 'processing')
  AND "task_id" IN (SELECT "task_id" FROM "affected");

DELETE FROM "task_run" WHERE "base_id" IS NULL;

ALTER TABLE "task_run" DROP CONSTRAINT IF EXISTS "task_run_base_id_not_null";
ALTER TABLE "task_run" ADD CONSTRAINT "task_run_base_id_not_null" CHECK ("base_id" IS NOT NULL) NOT VALID;
