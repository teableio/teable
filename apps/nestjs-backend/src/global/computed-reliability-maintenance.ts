import { computedReliabilityReadinessSql } from '@teable/v2-postgres-schema';
import type { Knex } from 'knex';

export const reliabilityTable = (db: Knex, schema: string | undefined, name: string) =>
  schema ? db(name).withSchema(schema) : db(name);

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
