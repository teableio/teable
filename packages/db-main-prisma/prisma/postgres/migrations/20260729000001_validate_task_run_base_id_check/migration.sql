-- Kept as its own migration: VALIDATE takes only SHARE UPDATE EXCLUSIVE, so
-- concurrent task_run reads/writes keep flowing while the heap is scanned —
-- it must never share a transaction with the previous migration's ADD
-- CONSTRAINT, whose ACCESS EXCLUSIVE lock would otherwise pin across this
-- scan. Idempotent.
ALTER TABLE "task_run" VALIDATE CONSTRAINT "task_run_base_id_not_null";
