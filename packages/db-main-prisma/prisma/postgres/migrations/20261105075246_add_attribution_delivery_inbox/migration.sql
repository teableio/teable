-- Durable consumption receipt for metadata-side effects delivered from the data plane.
-- The effect and this row commit in one metadata transaction, so redelivery is a no-op.
CREATE TABLE IF NOT EXISTS "domain_event_inbox" (
    "consumer_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "domain_event_inbox_pkey" PRIMARY KEY ("consumer_id","event_id")
);

CREATE INDEX IF NOT EXISTS "domain_event_inbox_event_id_idx" ON "domain_event_inbox"("event_id");
