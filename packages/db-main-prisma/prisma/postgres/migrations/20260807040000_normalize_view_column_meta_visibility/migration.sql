-- Historical column metadata can retain visibility keys from a different View subtype.
-- Keep only the visibility/layout keys supported by the active View type so v2 reads
-- satisfy the strict public View contract. Stale/deleted field metadata is preserved.
WITH normalized_entries AS (
  SELECT
    v."id" AS "view_id",
    entry."key" AS "field_id",
    entry."value" AS "old_value",
    CASE
      WHEN f."id" IS NULL OR jsonb_typeof(entry."value") <> 'object' THEN entry."value"
      WHEN v."type" = 'grid' THEN entry."value" - ARRAY['visible', 'required']::text[]
      WHEN v."type" = 'plugin' THEN
        entry."value" - ARRAY['visible', 'width', 'required', 'statisticFunc']::text[]
      WHEN v."type" = 'form' THEN
        entry."value" - ARRAY['hidden', 'width', 'statisticFunc']::text[]
      WHEN v."type" IN ('kanban', 'gallery', 'calendar') THEN
        entry."value" - ARRAY['hidden', 'width', 'required', 'statisticFunc']::text[]
      ELSE entry."value"
    END AS "normalized_value"
  FROM "view" AS v
  CROSS JOIN LATERAL jsonb_each(
    CASE
      WHEN jsonb_typeof(v."column_meta"::jsonb) = 'object' THEN v."column_meta"::jsonb
      ELSE '{}'::jsonb
    END
  ) AS entry
  LEFT JOIN "field" AS f
    ON f."id" = entry."key"
    AND f."table_id" = v."table_id"
    AND f."deleted_time" IS NULL
  WHERE v."deleted_time" IS NULL
),
normalized_views AS (
  SELECT
    "view_id",
    jsonb_object_agg("field_id", "normalized_value") AS "column_meta"
  FROM normalized_entries
  GROUP BY "view_id"
  HAVING bool_or("normalized_value" IS DISTINCT FROM "old_value")
)
UPDATE "view" AS v
SET "column_meta" = normalized."column_meta"::text
FROM normalized_views AS normalized
WHERE v."id" = normalized."view_id";
