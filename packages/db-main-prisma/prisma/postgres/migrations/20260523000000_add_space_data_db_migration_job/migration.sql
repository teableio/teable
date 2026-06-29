DO $$
BEGIN
  IF to_regtype('"SpaceDataDbMigrationJobState"') IS NULL THEN
    CREATE TYPE "SpaceDataDbMigrationJobState" AS ENUM (
      'pending',
      'preflight',
      'freezing_writes',
      'copying',
      'validating',
      'switching',
      'succeeded',
      'failed',
      'canceled',
      'rolled_back'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "space_data_db_migration_job" (
  "id" TEXT NOT NULL,
  "space_id" TEXT NOT NULL,
  "source_connection_id" TEXT,
  "target_connection_id" TEXT,
  "target_mode" TEXT NOT NULL DEFAULT 'migrate-space',
  "state" "SpaceDataDbMigrationJobState" NOT NULL DEFAULT 'pending',
  "target_url_fingerprint" TEXT NOT NULL,
  "target_internal_schema" TEXT NOT NULL,
  "inventory" JSONB,
  "copy_stats" JSONB,
  "validation_stats" JSONB,
  "last_error" TEXT,
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "created_by" TEXT NOT NULL,
  "created_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_modified_time" TIMESTAMP(3),
  CONSTRAINT "space_data_db_migration_job_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "space_data_db_migration_job_active_space_id_key"
ON "space_data_db_migration_job"("space_id")
WHERE "state" IN ('pending', 'preflight', 'freezing_writes', 'copying', 'validating', 'switching');

CREATE INDEX IF NOT EXISTS "space_data_db_migration_job_space_id_state_idx"
ON "space_data_db_migration_job"("space_id", "state");

CREATE INDEX IF NOT EXISTS "space_data_db_migration_job_source_connection_id_idx"
ON "space_data_db_migration_job"("source_connection_id");

CREATE INDEX IF NOT EXISTS "space_data_db_migration_job_target_connection_id_idx"
ON "space_data_db_migration_job"("target_connection_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'space_data_db_migration_job_space_id_fkey'
      AND conrelid = '"space_data_db_migration_job"'::regclass
  ) THEN
    ALTER TABLE "space_data_db_migration_job"
    ADD CONSTRAINT "space_data_db_migration_job_space_id_fkey"
    FOREIGN KEY ("space_id")
    REFERENCES "space"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'space_data_db_migration_job_source_connection_id_fkey'
      AND conrelid = '"space_data_db_migration_job"'::regclass
  ) THEN
    ALTER TABLE "space_data_db_migration_job"
    ADD CONSTRAINT "space_data_db_migration_job_source_connection_id_fkey"
    FOREIGN KEY ("source_connection_id")
    REFERENCES "data_db_connection"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'space_data_db_migration_job_target_connection_id_fkey'
      AND conrelid = '"space_data_db_migration_job"'::regclass
  ) THEN
    ALTER TABLE "space_data_db_migration_job"
    ADD CONSTRAINT "space_data_db_migration_job_target_connection_id_fkey"
    FOREIGN KEY ("target_connection_id")
    REFERENCES "data_db_connection"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
  END IF;
END $$;
