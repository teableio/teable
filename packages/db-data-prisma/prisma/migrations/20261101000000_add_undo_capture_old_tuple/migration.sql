-- Runs in the configured data DB internal schema, including existing space BYODB connections.
-- Keep legacy rows NULL: missing evidence must never authorize a local generation transition.
ALTER TABLE "__undo_log" ADD COLUMN IF NOT EXISTS "old_tuple" JSONB;

CREATE OR REPLACE FUNCTION "__teable_capture_undo_row"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  batch_id text;
  captured_record_id text;
  captured_old_row jsonb;
  captured_new_row jsonb;
  captured_old_tuple jsonb;
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
    RETURN NULL;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    -- OLD is the exact predecessor, including when the row was updated again in this statement.
    captured_old_tuple := jsonb_build_object(
      'xmin', OLD.xmin::text,
      'ctid', OLD.ctid::text,
      'relationOid', OLD.tableoid::text,
      'relationFilenode', pg_relation_filenode(OLD.tableoid)::text
    );
  END IF;

  INSERT INTO "__undo_log" (
    "batch_id", "operation", "table_name", "record_id", "old_row", "new_row", "old_tuple"
  )
  VALUES (
    batch_id,
    TG_OP,
    TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME,
    captured_record_id,
    captured_old_row,
    captured_new_row,
    captured_old_tuple
  );

  RETURN NULL;
END;
$$;
