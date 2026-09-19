/** Relation names come from each adapter's schema-aware identifier compiler. */
export const computedReliabilityReadinessSql = (
  issueRelation: string,
  scopeRelation: string
): string => {
  const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const columns = [
    ['issue', 'id', 'text'],
    ['issue', 'task_id', 'text'],
    ['issue', 'base_id', 'text'],
    ['issue', 'source_table_id', 'text'],
    ['issue', 'error', 'text'],
    ['issue', 'failure_kind', 'text'],
    ['issue', 'failure_phase', 'text'],
    ['issue', 'error_code', 'text'],
    ['issue', 'status', 'text'],
    ['issue', 'scope_complete', 'boolean'],
    ['issue', 'occurrences', 'integer'],
    ['issue', 'first_seen_at', 'timestamp with time zone'],
    ['issue', 'last_seen_at', 'timestamp with time zone'],
    ['issue', 'closed_at', 'timestamp with time zone'],
    ['issue', 'confirmed_by', 'text'],
    ['issue', 'confirmation_reason', 'text'],
    ['scope', 'issue_id', 'text'],
    ['scope', 'table_id', 'text'],
    ['scope', 'field_id', 'text'],
  ];
  return `WITH relation_names(kind,parts) AS (
    VALUES ('issue',parse_ident(${literal(issueRelation)})),('scope',parse_ident(${literal(scopeRelation)}))
  ), relations AS (
    SELECT kind,(SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relname=parts[cardinality(parts)] AND
        ((cardinality(parts)=2 AND n.nspname=parts[1]) OR
         (cardinality(parts)=1 AND pg_table_is_visible(c.oid))) LIMIT 1) AS oid
      FROM relation_names
  ), required_columns(kind,name,type) AS (
    VALUES ${columns.map((values) => `(${values.map(literal).join(',')})`).join(',')}
  ), required_keys(kind,names) AS (
    VALUES ('issue',ARRAY['id']::text[]),('issue',ARRAY['task_id']::text[]),
      ('scope',ARRAY['issue_id','table_id','field_id']::text[])
  ), required_privileges(kind,privilege) AS (
    VALUES ('issue','SELECT'),('issue','INSERT'),('issue','UPDATE'),('issue','DELETE'),('scope','SELECT'),('scope','INSERT'),('scope','DELETE')
  ) SELECT
    NOT EXISTS(SELECT 1 FROM relations r LEFT JOIN pg_class c ON c.oid=r.oid
      WHERE r.oid IS NULL OR c.relkind NOT IN ('r','p') OR c.relrowsecurity OR c.relforcerowsecurity OR NOT has_schema_privilege(c.relnamespace,'USAGE'))
    AND NOT EXISTS(SELECT 1 FROM required_columns expected JOIN relations r USING(kind)
      WHERE NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=r.oid
        AND a.attname=expected.name AND NOT a.attisdropped AND a.atttypid=to_regtype(expected.type)
        AND (expected.name IN ('failure_kind','failure_phase','error_code','closed_at','confirmed_by','confirmation_reason') OR a.attnotnull)
        AND (expected.kind <> 'issue' OR expected.name NOT IN ('status','scope_complete','occurrences','first_seen_at','last_seen_at') OR a.atthasdef)))
    AND NOT EXISTS(SELECT 1 FROM required_keys expected JOIN relations r USING(kind)
      WHERE NOT EXISTS(SELECT 1 FROM pg_index idx WHERE idx.indrelid=r.oid
        AND idx.indisunique AND idx.indisvalid AND idx.indisready AND idx.indimmediate
        AND idx.indpred IS NULL AND idx.indexprs IS NULL
        AND idx.indnkeyatts=cardinality(expected.names)
        AND ARRAY(SELECT a.attname::text FROM unnest(idx.indkey) WITH ORDINALITY key(attnum,position)
          JOIN pg_attribute a ON a.attrelid=r.oid AND a.attnum=key.attnum
          WHERE key.position<=idx.indnkeyatts) @> expected.names))
    AND NOT EXISTS(SELECT 1 FROM required_privileges expected JOIN relations r USING(kind)
      WHERE r.oid IS NULL OR NOT has_table_privilege(r.oid,expected.privilege)) AS ready`;
};
