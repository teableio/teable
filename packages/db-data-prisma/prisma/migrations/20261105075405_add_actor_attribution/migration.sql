-- Existing modification-history rows gain a scalar business initiator while the
-- technical executor stays in created_by. Idempotent because the default data
-- database is the metadata database and already ran the metadata lane first.
ALTER TABLE "record_history" ADD COLUMN IF NOT EXISTS "actor_type" TEXT;
ALTER TABLE "record_history" ADD COLUMN IF NOT EXISTS "actor_id" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'record_history_actor_pair_check'
      AND conrelid = 'record_history'::regclass
  ) THEN
    ALTER TABLE "record_history" ADD CONSTRAINT "record_history_actor_pair_check" CHECK (
      ("actor_type" IS NULL AND "actor_id" IS NULL)
      OR ("actor_type" IS NOT NULL AND "actor_id" IS NOT NULL
        AND "actor_type" IN ('user', 'appUser', 'automation', 'system')
        AND length("actor_id") > 0)
    );
  END IF;
END;
$$;

-- Frozen attribution envelope for durable delivery. NULL means an older message
-- with no recorded initiator; consumers must not infer one from their own CLS.
ALTER TABLE "domain_event_outbox" ADD COLUMN IF NOT EXISTS "attribution" JSONB;
