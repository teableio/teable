CREATE TABLE IF NOT EXISTS computed_reliability_issue (
 id text PRIMARY KEY, task_id text UNIQUE NOT NULL, base_id text NOT NULL,
 source_table_id text NOT NULL, error text NOT NULL,
 failure_kind text, failure_phase text, error_code text,
 status text NOT NULL DEFAULT 'open', scope_complete boolean NOT NULL DEFAULT false,
 occurrences integer NOT NULL DEFAULT 1, first_seen_at timestamptz NOT NULL DEFAULT now(),
 last_seen_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz,
 confirmed_by text, confirmation_reason text
);
CREATE INDEX IF NOT EXISTS computed_reliability_issue_open_idx ON computed_reliability_issue (base_id, status, first_seen_at);
CREATE INDEX IF NOT EXISTS computed_reliability_issue_source_idx ON computed_reliability_issue(source_table_id,status,first_seen_at);
CREATE INDEX IF NOT EXISTS computed_reliability_issue_closed_idx ON computed_reliability_issue(closed_at) WHERE closed_at IS NOT NULL;
CREATE TABLE IF NOT EXISTS computed_reliability_scope (
 issue_id text NOT NULL, table_id text NOT NULL,
 field_id text NOT NULL, PRIMARY KEY(issue_id, table_id, field_id)
);
CREATE INDEX IF NOT EXISTS computed_reliability_scope_field_idx ON computed_reliability_scope(table_id, field_id);

INSERT INTO computed_reliability_issue(id,task_id,base_id,source_table_id,error,first_seen_at,last_seen_at)
SELECT 'issue:' || id,id,base_id,seed_table_id,coalesce(last_error,'Historical computed failure'),failed_at,failed_at
FROM computed_update_dead_letter ON CONFLICT(task_id) DO NOTHING;


-- Recover only placements explicitly present in historical plans; seed-only failures stay unknown.
INSERT INTO computed_reliability_scope(issue_id,table_id,field_id)
SELECT 'issue:' || d.id, step->>'tableId', field_id
FROM computed_update_dead_letter d
CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(d.steps)='array' THEN d.steps ELSE '[]'::jsonb END) step
CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(step->'fieldIds')='array' THEN step->'fieldIds' ELSE '[]'::jsonb END) field_id
WHERE step->>'tableId' IS NOT NULL AND field_id IS NOT NULL
ON CONFLICT DO NOTHING;
UPDATE computed_reliability_issue i SET scope_complete=true
WHERE EXISTS (SELECT 1 FROM computed_reliability_scope s WHERE s.issue_id=i.id)
AND EXISTS (SELECT 1 FROM computed_update_dead_letter d WHERE d.id=i.task_id);
