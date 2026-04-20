export const undoCaptureGlobalStatements = [
  `
    CREATE TABLE IF NOT EXISTS "public"."__undo_log" (
      "id" BIGSERIAL PRIMARY KEY,
      "batch_id" TEXT NOT NULL,
      "operation" TEXT NOT NULL,
      "table_name" TEXT NOT NULL,
      "record_id" TEXT NOT NULL,
      "old_row" JSONB,
      "new_row" JSONB,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS "__undo_log_batch_id_idx"
    ON "public"."__undo_log" ("batch_id")
  `,
  `
    ALTER TABLE "public"."__undo_log" SET (
      autovacuum_vacuum_scale_factor = 0.01,
      autovacuum_vacuum_threshold = 100
    )
  `,
  `
    ALTER SEQUENCE IF EXISTS "public"."__undo_log_id_seq"
    CACHE 100
  `,
  `
    CREATE OR REPLACE FUNCTION "public"."__teable_capture_undo_row"()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
      batch_id text;
      captured_record_id text;
      captured_old_row jsonb;
      captured_new_row jsonb;
    BEGIN
      batch_id := current_setting('teable.undo_batch_id', true);

      IF TG_OP = 'INSERT' THEN
        captured_record_id := COALESCE(NEW."__id"::text, '');
        captured_new_row := to_jsonb(NEW);
      ELSIF TG_OP = 'UPDATE' THEN
        captured_record_id := COALESCE(NEW."__id"::text, OLD."__id"::text, '');
        captured_old_row := to_jsonb(OLD);
        captured_new_row := to_jsonb(NEW);
      ELSIF TG_OP = 'DELETE' THEN
        captured_record_id := COALESCE(OLD."__id"::text, '');
        captured_old_row := to_jsonb(OLD);
      END IF;

      IF batch_id IS NULL OR batch_id = '' THEN
        -- For AFTER triggers, the return value is ignored; RETURN NULL is idiomatic.
        RETURN NULL;
      END IF;

      INSERT INTO "public"."__undo_log" (
        "batch_id",
        "operation",
        "table_name",
        "record_id",
        "old_row",
        "new_row"
      )
      VALUES (
        batch_id,
        TG_OP,
        TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME,
        captured_record_id,
        captured_old_row,
        captured_new_row
      );

      -- For AFTER triggers, the return value is ignored; RETURN NULL is idiomatic.
      RETURN NULL;
    END;
    $$;
  `,
] as const;
