-- Attachment support tables for BYODB data-plane record mutations.
--
-- V2 attachment field writes resolve uploaded file metadata from the data DB. BYODB spaces
-- therefore need the same shared attachment tables that the default data plane has.

CREATE TABLE IF NOT EXISTS "attachments" (
  "id" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "hash" TEXT NOT NULL,
  "size" BIGINT NOT NULL,
  "mimetype" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "width" INTEGER,
  "height" INTEGER,
  "deleted_time" TIMESTAMPTZ,
  "created_time" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "created_by" TEXT NOT NULL,
  "last_modified_by" TEXT,
  "thumbnail_path" TEXT,

  CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "attachments_token_key" ON "attachments"("token");

CREATE TABLE IF NOT EXISTS "attachments_table" (
  "id" TEXT NOT NULL,
  "attachment_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "table_id" TEXT NOT NULL,
  "record_id" TEXT NOT NULL,
  "field_id" TEXT NOT NULL,
  "created_time" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "created_by" TEXT NOT NULL,
  "last_modified_by" TEXT,
  "last_modified_time" TIMESTAMPTZ,

  CONSTRAINT "attachments_table_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "attachments_table_table_id_record_id_idx"
ON "attachments_table"("table_id", "record_id");

CREATE INDEX IF NOT EXISTS "attachments_table_table_id_field_id_idx"
ON "attachments_table"("table_id", "field_id");

CREATE INDEX IF NOT EXISTS "attachments_table_attachment_id_idx"
ON "attachments_table"("attachment_id");

CREATE INDEX IF NOT EXISTS "attachments_table_token_idx"
ON "attachments_table"("token");
