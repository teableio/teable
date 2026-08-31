-- Durable per-stage state for budget-staged computed updates (exclusion ledger
-- + frontier queue), keyed by the continuation chain's root task id. Purely
-- additive: no existing table or index changes, so it is safe under rolling
-- deploys.
CREATE TABLE "computed_update_stage_ledger" (
    "scope_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "table_id" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "seq" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "computed_update_stage_ledger_pkey" PRIMARY KEY ("scope_id","kind","table_id","record_id"),
    CONSTRAINT "computed_update_stage_ledger_kind_check" CHECK ("kind" IN ('excluded','frontier','consumed'))
);

-- CreateIndex
CREATE INDEX "computed_update_stage_ledger_scope_id_kind_seq_idx" ON "computed_update_stage_ledger"("scope_id", "kind", "seq");
