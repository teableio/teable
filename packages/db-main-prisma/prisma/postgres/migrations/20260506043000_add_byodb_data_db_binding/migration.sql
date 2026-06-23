DO $$
BEGIN
  CREATE TYPE "DataDbProvider" AS ENUM ('postgres');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "DataDbConnectionStatus" AS ENUM (
    'pending',
    'validating',
    'ready',
    'error',
    'migrating',
    'disabled'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "SpaceDataDbBindingMode" AS ENUM ('default', 'byodb');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "SpaceDataDbBindingState" AS ENUM (
    'ready',
    'validating',
    'initializing',
    'migrating',
    'error',
    'disabled'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "data_db_connection" (
  "id" TEXT NOT NULL,
  "provider" "DataDbProvider" NOT NULL DEFAULT 'postgres',
  "encrypted_url" TEXT NOT NULL,
  "url_fingerprint" TEXT NOT NULL,
  "display_host" TEXT,
  "display_database" TEXT,
  "status" "DataDbConnectionStatus" NOT NULL DEFAULT 'pending',
  "schema_version" TEXT,
  "capabilities" JSONB,
  "last_validated_at" TIMESTAMP(3),
  "last_error" TEXT,
  "created_by" TEXT NOT NULL,
  "created_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_modified_time" TIMESTAMP(3),

  CONSTRAINT "data_db_connection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "space_data_db_binding" (
  "id" TEXT NOT NULL,
  "space_id" TEXT NOT NULL,
  "data_db_connection_id" TEXT,
  "mode" "SpaceDataDbBindingMode" NOT NULL DEFAULT 'default',
  "state" "SpaceDataDbBindingState" NOT NULL DEFAULT 'ready',
  "created_by" TEXT NOT NULL,
  "created_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_modified_time" TIMESTAMP(3),

  CONSTRAINT "space_data_db_binding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "data_db_connection_url_fingerprint_key"
ON "data_db_connection"("url_fingerprint");

CREATE UNIQUE INDEX IF NOT EXISTS "space_data_db_binding_space_id_key"
ON "space_data_db_binding"("space_id");

CREATE INDEX IF NOT EXISTS "space_data_db_binding_data_db_connection_id_idx"
ON "space_data_db_binding"("data_db_connection_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'space_data_db_binding_space_id_fkey'
      AND conrelid = '"space_data_db_binding"'::regclass
  ) THEN
    ALTER TABLE "space_data_db_binding"
    ADD CONSTRAINT "space_data_db_binding_space_id_fkey"
    FOREIGN KEY ("space_id")
    REFERENCES "space"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'space_data_db_binding_data_db_connection_id_fkey'
      AND conrelid = '"space_data_db_binding"'::regclass
  ) THEN
    ALTER TABLE "space_data_db_binding"
    ADD CONSTRAINT "space_data_db_binding_data_db_connection_id_fkey"
    FOREIGN KEY ("data_db_connection_id")
    REFERENCES "data_db_connection"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
  END IF;
END $$;
