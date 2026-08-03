CREATE TEMP TABLE updated_column_t AS (
    SELECT
        jsonb_object_agg (
            KEY,
            CASE
                WHEN KEY = field.ID AND field.is_primary THEN VALUE || '{"visible": true}'::JSONB
                ELSE VALUE
            END
        ) AS column_meta,
        VIEW.ID AS view_id
    FROM
        VIEW,
        jsonb_each (column_meta::JSONB)
        JOIN field ON KEY = field.ID
    WHERE
        VIEW."type" = 'kanban'
    GROUP BY
        VIEW.ID
);

UPDATE VIEW
SET column_meta = updated_column_t.column_meta
FROM updated_column_t
WHERE VIEW.ID = updated_column_t.view_id;
