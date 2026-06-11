CREATE TABLE IF NOT EXISTS "schema_operation" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "phase" TEXT NOT NULL,
  "resource_type" TEXT NOT NULL,
  "resource_id" TEXT NOT NULL,
  "base_id" TEXT,
  "table_id" TEXT,
  "idempotency_key" TEXT NOT NULL,
  "payload" JSONB,
  "result" JSONB,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 8,
  "next_run_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "locked_at" TIMESTAMPTZ,
  "locked_by" TEXT,
  "last_error" TEXT,
  "created_time" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "created_by" TEXT NOT NULL,
  "last_modified_time" TIMESTAMPTZ,
  "last_modified_by" TEXT,

  CONSTRAINT "schema_operation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "schema_operation_idempotency_key_key" ON "schema_operation"("idempotency_key");
CREATE INDEX IF NOT EXISTS "schema_operation_status_next_run_at_idx" ON "schema_operation"("status", "next_run_at");
CREATE INDEX IF NOT EXISTS "schema_operation_resource_status_idx" ON "schema_operation"("resource_type", "resource_id", "status");
CREATE INDEX IF NOT EXISTS "schema_operation_base_status_idx" ON "schema_operation"("base_id", "status");
CREATE INDEX IF NOT EXISTS "schema_operation_table_status_idx" ON "schema_operation"("table_id", "status");
