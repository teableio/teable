-- Repair reference
INSERT INTO reference (id, to_field_id, from_field_id)
SELECT 'cmb' || substr(md5(random()::text), 1, 22)                               as id,
       f.id                                                                      as to_field_id,
       (regexp_matches(f.options::json ->> 'expression', '\{([^}]+)\}', 'g'))[1] as from_field_id
FROM field f
WHERE f.type = 'formula'
  AND f.deleted_time is null
  AND f.options::json ->> 'expression' IS NOT NULL
  AND f.options::json ->> 'expression' ~ '\{[^}]+\}'
  AND f.created_time > '2025-04-05'
ON CONFLICT (to_field_id, from_field_id) DO NOTHING;