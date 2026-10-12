-- Output changes are separate from the candidate/progress stage ledger.
CREATE TABLE "computed_update_change_frontier" (
  "scope_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "table_id" TEXT NOT NULL,
  "record_id" TEXT NOT NULL,
  "field_id" TEXT NOT NULL,
  CONSTRAINT "computed_update_change_frontier_pkey" PRIMARY KEY ("scope_id", "kind", "table_id", "record_id", "field_id"),
  CONSTRAINT "computed_update_change_frontier_kind_check" CHECK ("kind" IN ('changed', 'covered', 'fallback', 'processed'))
);

-- Indexed active-continuation lookup for bounded orphan cleanup.
CREATE INDEX "computed_update_outbox_ledger_scope_idx"
  ON "computed_update_outbox" (("dirty_stats"->>'ledgerScopeId'));
