-- This is a separate migration file from the NOT VALID add in
-- 20261102010000_allow_computed_rerun_ledger_kinds; with the installed Prisma CLI
-- the later file was observed to run in its own transaction. The scan therefore
-- takes SHARE UPDATE EXCLUSIVE and concurrent DML keeps working instead of waiting
-- behind the ADD's ACCESS EXCLUSIVE lock.
ALTER TABLE "computed_update_stage_ledger"
  VALIDATE CONSTRAINT "computed_update_stage_ledger_kind_check";
