import { computedReliabilityReadinessSql } from '@teable/v2-postgres-schema';
import type { Knex } from 'knex';

export const reliabilityTable = (db: Knex, schema: string | undefined, name: string) =>
  schema ? db(name).withSchema(schema) : db(name);

/** Tables whose computed reliability state may need a reconciliation pass. */
export const reliabilityCandidateQuery = (db: Knex, schema: string | undefined) => {
  const active = reliabilityTable(db, schema, 'computed_task_field_ref').distinct(
    'base_id',
    'table_id'
  );
  // withSchema already qualifies JOIN relations. Prefixing the name again emits
  // "schema"."schema"."table", which Postgres rejects as 0A000.
  const scoped = reliabilityTable(db, schema, 'computed_reliability_scope as s')
    .join('computed_reliability_issue as i', 'i.id', 's.issue_id')
    .where('i.status', 'open')
    .select('i.base_id', 's.table_id');
  const unknown = reliabilityTable(db, schema, 'computed_reliability_issue')
    .where({ status: 'open', scope_complete: false })
    .select('base_id', { table_id: 'source_table_id' });
  return db.select('base_id', 'table_id').from(active.union([scoped, unknown]).as('candidates'));
};

export const isComputedReliabilityReady = async (db: Knex, schema?: string): Promise<boolean> => {
  const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;
  const relation = (name: string) => (schema ? `${quote(schema)}.${quote(name)}` : quote(name));
  const result = await db.raw<{ rows: Array<{ ready: boolean }> }>(
    computedReliabilityReadinessSql(
      relation('computed_reliability_issue'),
      relation('computed_reliability_scope')
    )
  );
  return result.rows[0]?.ready === true;
};

/** Apply eligibility before ordering/limits, so disabled or migrated Bases cannot starve maintenance. */
export const applyComputedReliabilityBaseFilter = (
  query: Knex.QueryBuilder,
  target: { storage: 'default' | 'byodb'; baseSpaceMapping?: ReadonlyArray<{ baseId: string }> },
  routedAway: ReadonlyArray<string>,
  column = 'base_id'
): Knex.QueryBuilder => {
  const allowed = (process.env.COMPUTED_RELIABILITY_BASE_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  if (allowed.length) query.whereIn(column, allowed);
  if (target.storage === 'byodb')
    query.whereIn(
      column,
      (target.baseSpaceMapping ?? []).map((mapping) => mapping.baseId)
    );
  else if (routedAway.length) query.whereNotIn(column, [...routedAway]);
  return query;
};
