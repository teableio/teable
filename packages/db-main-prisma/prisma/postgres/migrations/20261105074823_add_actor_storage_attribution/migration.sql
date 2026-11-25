-- Per-table, opt-in attribution capability. 0 means the four physical actor
-- columns are not available and legacy native CRUD continues unchanged.
ALTER TABLE "table_meta" ADD COLUMN "actor_storage_version" INTEGER NOT NULL DEFAULT 0;

-- Scalar business initiator for the existing modification-history semantics.
ALTER TABLE "record_history" ADD COLUMN "actor_type" TEXT,
ADD COLUMN "actor_id" TEXT;

ALTER TABLE "record_history" ADD CONSTRAINT "record_history_actor_pair_check" CHECK (
  ("actor_type" IS NULL AND "actor_id" IS NULL)
  OR ("actor_type" IS NOT NULL AND "actor_id" IS NOT NULL
    AND "actor_type" IN ('user', 'appUser', 'automation', 'system')
    AND length("actor_id") > 0)
);
