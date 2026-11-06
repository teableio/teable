-- Runs in the configured data DB internal schema, including existing space BYODB connections.
--
-- An inactive capture must not serialize row images. The batch gate used to run after the
-- TG_OP branches, so every write to a captured table paid to_jsonb(OLD)/to_jsonb(NEW) even
-- when no undo batch was open. The gate now runs directly after current_setting; every
-- capture-enabled semantic is unchanged, including old_row, new_row and old_tuple.
--
-- Only the shared trigger function is replaced. No business row is rewritten and no
-- "__teable_undo_capture" trigger is rebound: CREATE OR REPLACE keeps the function OID, so
-- every existing trigger keeps pointing at the same function.
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

  IF batch_id IS NULL OR batch_id = '' THEN
    RETURN NULL;
  END IF;

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

-- Tables copied from the main database keep the trigger definition they were restored with,
-- so they resolve to "public"."__teable_capture_undo_row" until the v2 snapshot capture
-- lazily rebinds them on a capture-enabled write. A plain inactive value update never
-- reaches that rebind, so the stale public function must be gated as well.
--
-- The public function is a database-wide shared object and is not necessarily owned by this
-- data DB: it can be the main database's copy writing "public"."__undo_log", or the space
-- copy compatibility copy writing the unqualified "__undo_log" through the caller's
-- search_path. Only the gate position changes; every other byte of the existing definition,
-- including its log target and search_path, is preserved. A database whose triggers do not
-- depend on it gets no public function created or changed.
DO $capture_gate_compat$
DECLARE
  assignment constant text := 'batch_id := current_setting(''teable.undo_batch_id'', true);';
  gate_pattern constant text := E'IF batch_id IS NULL OR batch_id = '''' THEN[[:space:]]*(--[^\\n]*\\n[[:space:]]*)?RETURN NULL;[[:space:]]*END IF;';
  function_oid oid;
  definition text;
  gate text;
BEGIN
  IF current_schema() = 'public' THEN
    RETURN;
  END IF;

  -- Catalog lookup avoids requiring USAGE on a public schema this role may not use.
  SELECT function.oid
    INTO function_oid
    FROM pg_catalog.pg_proc AS function
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = function.pronamespace
   WHERE namespace.nspname = 'public'
     AND function.proname = '__teable_capture_undo_row'
     AND function.pronargs = 0
     AND function.prokind = 'f'
     AND function.prorettype = 'pg_catalog.trigger'::pg_catalog.regtype;

  IF function_oid IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t
    WHERE NOT t.tgisinternal AND t.tgname = '__teable_undo_capture'
      AND t.tgfoid = function_oid
  ) THEN
    RETURN;
  END IF;

  definition := pg_catalog.pg_get_functiondef(function_oid);
  -- Accept exactly the known assignment and the plain/commented inactive return.
  -- Unknown or ambiguous custom definitions are not safe to rewrite automatically.
  IF (length(definition) - length(replace(definition, assignment, ''))) <> length(assignment)
     OR (SELECT count(*) FROM regexp_matches(definition, gate_pattern, 'g')) <> 1
     OR strpos(definition, 'to_jsonb(') = 0 THEN
    RAISE EXCEPTION 'Unrecognized public undo capture function; refusing to move its batch gate';
  END IF;
  -- The optional comment is a capturing group; obtain the complete matched block.
  gate := (SELECT match[1] FROM regexp_matches(definition, '(' || gate_pattern || ')') AS match);
  IF strpos(definition, gate) < strpos(definition, assignment) THEN
    RAISE EXCEPTION 'Public undo capture batch gate precedes its assignment';
  END IF;
  IF strpos(definition, gate) < strpos(definition, 'to_jsonb(') THEN
    RETURN;
  END IF;

  definition := replace(definition, gate, '');
  definition := replace(definition, assignment, assignment || E'\n\n  ' || gate);
  EXECUTE definition;
END;
$capture_gate_compat$;
