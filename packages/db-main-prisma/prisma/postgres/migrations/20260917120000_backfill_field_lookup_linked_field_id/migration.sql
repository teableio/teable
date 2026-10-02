-- Copy lookup/rollup linkFieldId from lookup_options JSON onto the denormalized
-- lookup_linked_field_id column. New writes already persist both; leftover NULL
-- columns forced FieldDependencyGraph.loadIncremental to run a JSON LATERAL
-- fallback (branch 2b) on every dependency expansion.
-- After this backfill that fallback is dead and is removed from the hot SQL.
UPDATE "field"
SET "lookup_linked_field_id" = ("lookup_options"::jsonb)->>'linkFieldId'
WHERE "deleted_time" IS NULL
  AND "lookup_linked_field_id" IS NULL
  AND "lookup_options" IS NOT NULL
  AND "lookup_options" <> ''
  AND ("type" = 'rollup' OR "is_lookup" = true)
  AND ("lookup_options"::jsonb)->>'linkFieldId' IS NOT NULL
  AND ("lookup_options"::jsonb)->>'linkFieldId' <> '';
