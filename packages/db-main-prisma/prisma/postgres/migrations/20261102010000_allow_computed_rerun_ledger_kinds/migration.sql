-- Preserve existing stage kinds while admitting durable recovery input metadata.
-- Run before deploying workers that write rerun-source / rerun-input-v1.
--
-- Dropping and adding in one ALTER avoids any window without a kind constraint.
-- NOT VALID keeps the statement catalog-only (brief ACCESS EXCLUSIVE, no ledger
-- scan). 20261102010001_validate_computed_rerun_ledger_kinds is a separate
-- migration file, and the installed Prisma CLI was observed to apply a later
-- migration file in a separate transaction, so its VALIDATE scan holds only
-- SHARE UPDATE EXCLUSIVE and concurrent DML keeps working.
ALTER TABLE "computed_update_stage_ledger"
  DROP CONSTRAINT IF EXISTS "computed_update_stage_ledger_kind_check",
  ADD CONSTRAINT "computed_update_stage_ledger_kind_check"
    CHECK ("kind" IN ('excluded', 'frontier', 'consumed', 'rerun-source', 'rerun-input-v1'))
    NOT VALID;
