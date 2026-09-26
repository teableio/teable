CREATE INDEX IF NOT EXISTS "domain_event_outbox_unsettled_idx"
  ON "domain_event_outbox" ("id")
  WHERE settled IS NULL AND NOT unpublished;
CREATE INDEX IF NOT EXISTS "domain_event_outbox_legacy_settled_created_at_idx"
  ON "domain_event_outbox" ("created_at")
  WHERE settled IS NOT NULL AND settled_at IS NULL;
CREATE INDEX IF NOT EXISTS "domain_event_inbox_event_id_idx"
  ON "domain_event_inbox" ("event_id");
