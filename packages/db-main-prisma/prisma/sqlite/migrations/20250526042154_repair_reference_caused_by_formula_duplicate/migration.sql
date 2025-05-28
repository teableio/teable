-- Repair reference
INSERT INTO reference (id, to_field_id, from_field_id)
SELECT 'cmb' || 
       CASE 
         WHEN (abs(random()) % 2) = 0 
         THEN substr(hex(randomblob(11)), 1, 22)
         ELSE substr(lower(hex(randomblob(11))), 1, 22)
       END                                                             as id,
       f.id                                                            as to_field_id,
       substr(json_extract(f.options, '$.expression'), 
              instr(json_extract(f.options, '$.expression'), '{') + 1,
              instr(json_extract(f.options, '$.expression'), '}') - instr(json_extract(f.options, '$.expression'), '{') - 1
       )                                                               as from_field_id
FROM field f
WHERE f.type = 'formula'
  AND f.deleted_time is null
  AND json_extract(f.options, '$.expression') IS NOT NULL
  AND json_extract(f.options, '$.expression') LIKE '%{%}%'
  AND f.created_time >= strftime('%s', '2025-04-05') * 1000
ON CONFLICT (to_field_id, from_field_id) DO NOTHING;