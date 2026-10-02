CREATE TABLE IF NOT EXISTS "domain_event_outbox" (
    "id" TEXT NOT NULL,
    "base_id" TEXT NOT NULL,
    "table_id" TEXT,
    "message_name" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "aggregate_id" TEXT,
    "payload" JSONB NOT NULL,
    "payload_bytes" INTEGER NOT NULL,
    "catalog_generation" INTEGER NOT NULL,
    "required_consumers" JSONB NOT NULL,
    "binding_id" TEXT,
    "storage_epoch" INTEGER,
    "unpublished" BOOLEAN NOT NULL DEFAULT TRUE,
    "settled" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "domain_event_outbox_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "domain_event_outbox_base_id_idx" ON "domain_event_outbox"("base_id");
CREATE INDEX IF NOT EXISTS "domain_event_outbox_unpublished_idx" ON "domain_event_outbox"("created_at") WHERE unpublished;

CREATE TABLE IF NOT EXISTS "domain_event_delivery" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "consumer_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 12,
    "lease_token" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "domain_event_delivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "domain_event_delivery_event_id_consumer_id_key"
  ON "domain_event_delivery"("event_id", "consumer_id");
CREATE INDEX IF NOT EXISTS "domain_event_delivery_due_idx"
  ON "domain_event_delivery"("next_attempt_at")
  WHERE status IN ('pending', 'processing');

CREATE TABLE IF NOT EXISTS "domain_event_inbox" (
    "consumer_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "domain_event_inbox_pkey" PRIMARY KEY ("consumer_id","event_id")
);
