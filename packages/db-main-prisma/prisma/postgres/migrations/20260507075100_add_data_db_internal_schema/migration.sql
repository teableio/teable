ALTER TABLE "data_db_connection"
ADD COLUMN IF NOT EXISTS "internal_schema" TEXT;

UPDATE "data_db_connection"
SET "internal_schema" = 'teable_' || SUBSTRING(
  MD5(COALESCE("display_host", '') || '/' || COALESCE("display_database", '')),
  1,
  16
)
WHERE "internal_schema" IS NULL;

ALTER TABLE "data_db_connection"
ALTER COLUMN "internal_schema" SET NOT NULL;
