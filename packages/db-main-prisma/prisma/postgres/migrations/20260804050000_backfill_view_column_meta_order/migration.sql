-- Legacy column metadata can contain width/visibility patches without an order.
-- The public View contract requires every retained column entry to have a numeric order;
-- use the Table field order as the deterministic fallback for active fields.
WITH repaired_view_column_meta AS (
  SELECT
    v."id",
    jsonb_object_agg(
      entry."key",
      CASE
        WHEN jsonb_typeof(entry."value") = 'object'
          AND jsonb_typeof(entry."value" -> 'order') IS DISTINCT FROM 'number'
          AND f."id" IS NOT NULL
        THEN jsonb_set(entry."value", '{order}', to_jsonb(f."order"), true)
        ELSE entry."value"
      END
    ) AS "column_meta"
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
  GROUP BY v."id"
  HAVING bool_or(
    jsonb_typeof(entry."value") = 'object'
      AND jsonb_typeof(entry."value" -> 'order') IS DISTINCT FROM 'number'
      AND f."id" IS NOT NULL
  )
)
UPDATE "view" AS v
SET "column_meta" = repaired."column_meta"::text
FROM repaired_view_column_meta AS repaired
WHERE v."id" = repaired."id";
