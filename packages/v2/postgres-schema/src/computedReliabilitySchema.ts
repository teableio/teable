export const computedReliabilitySchemaSql = `CREATE TABLE IF NOT EXISTS computed_reliability_issue (
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
`;
