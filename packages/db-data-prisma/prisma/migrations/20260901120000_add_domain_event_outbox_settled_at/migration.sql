ALTER TABLE "domain_event_outbox"
  ADD COLUMN IF NOT EXISTS "settled_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "domain_event_outbox_settled_at_idx"
  ON "domain_event_outbox" ("settled_at")
  WHERE settled IS NOT NULL;
