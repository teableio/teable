-- Polyfill for pg_input_is_valid (PG < 16)
--
-- PG 16+ provides `pg_input_is_valid(text, regtype)` in `pg_catalog`.
-- For PG < 16, we create `public.teable_try_cast_valid(text, text)` to emulate the
-- "safe cast validity" behavior for a small set of types we need.
--
-- STABLE is used (not IMMUTABLE) because timestamp conversion can depend on timezone settings.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'pg_input_is_valid'
      AND pronamespace = 'pg_catalog'::regnamespace
  ) THEN
    CREATE OR REPLACE FUNCTION public.teable_try_cast_valid(input_text text, target_type text)
    RETURNS boolean
    LANGUAGE plpgsql
    STABLE
    AS $func$
    BEGIN
      IF input_text IS NULL THEN
        RETURN TRUE;
      END IF;

      CASE target_type
        WHEN 'jsonb' THEN
          PERFORM input_text::jsonb;
        WHEN 'numeric' THEN
          PERFORM input_text::numeric;
        WHEN 'timestamptz' THEN
          PERFORM input_text::timestamptz;
        WHEN 'timestamp' THEN
          PERFORM input_text::timestamp;
        ELSE
          RETURN FALSE;
      END CASE;
      RETURN TRUE;
    EXCEPTION WHEN OTHERS THEN
      RETURN FALSE;
    END;
    $func$;

    COMMENT ON FUNCTION public.teable_try_cast_valid(text, text) IS
      'Polyfill for pg_input_is_valid (PG < 16). Returns TRUE if input_text can be safely cast to target_type.';
  END IF;
END;
$$;
