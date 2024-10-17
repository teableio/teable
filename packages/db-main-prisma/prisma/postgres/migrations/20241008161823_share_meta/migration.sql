BEGIN;
-- update share meta for all views

UPDATE view
SET share_meta = COALESCE(
    jsonb_set(share_meta::jsonb, '{includeRecords}', 'true'::jsonb),
    '{"includeRecords": true}'::jsonb
)
WHERE (type = 'grid' OR type = 'kanban')
AND share_id IS NOT NULL;

UPDATE view
SET share_meta = COALESCE(
    jsonb_set(share_meta::jsonb, '{submit}', '{"allow": true}'::jsonb),
    '{"submit": {"allow": true}}'::jsonb
)
WHERE type = 'form'
AND share_id IS NOT NULL;

COMMIT;