import { buildIndexedSearchExpression } from '@teable/v2-adapter-db-postgres-shared';
import type { SearchFieldTextProjection } from '@teable/v2-core';
import { sql, type Kysely } from 'kysely';

import { makePhysicalTableSql, quoteIdentifier } from './helpers';
import type { TableQuerySubstringSearchProviderCapability } from './searchVector';
import type { UnknownPostgresDatabase } from './types';

type ResidualField = {
  readonly fieldDbName: string;
  readonly textProjection?: SearchFieldTextProjection;
};

/** Management-only inspection. Compare the complete parsed expression, never names alone. */
export const inspectResidualSearchIndex = async (
  db: Kysely<UnknownPostgresDatabase>,
  physical: { readonly schema: string; readonly tableName: string },
  indexName: string,
  fields: readonly ResidualField[],
  provider: Pick<
    TableQuerySubstringSearchProviderCapability,
    'provider' | 'operatorClass' | 'operatorClassSchema'
  >
): Promise<{
  readonly present: boolean;
  readonly owned: boolean;
  readonly ready: boolean;
  readonly oid?: string;
  readonly foreignDependents?: boolean;
}> => {
  const rows = await sql<{
    owned: boolean | null;
    ready: boolean | null;
    expression: string | null;
    oid: string;
    foreign_dependents: boolean;
  }>`
    SELECT i.indrelid = to_regclass(${makePhysicalTableSql(physical.schema, physical.tableName)})
      AND i.indnkeyatts = 1 AND i.indnatts = 1 AND i.indkey[0] = 0
      AND i.indpred IS NULL AND i.indexprs IS NOT NULL AND am.amname = 'gin'
      AND op.opcname = ${provider.operatorClass} AND extension.extname = ${provider.provider}
      AND (${provider.operatorClassSchema ?? null}::text IS NULL OR ns.nspname = ${provider.operatorClassSchema ?? null}) AS owned,
      i.indisvalid AND i.indisready AND i.indislive AS ready,
      pg_get_expr(i.indexprs, i.indrelid) AS expression,
      c.oid::text AS oid,
      EXISTS (SELECT 1 FROM pg_depend d WHERE d.refclassid = 'pg_class'::regclass
        AND d.refobjid = c.oid) AS foreign_dependents
    FROM pg_class c
    LEFT JOIN pg_index i ON i.indexrelid = c.oid
    LEFT JOIN pg_am am ON am.oid = c.relam
    LEFT JOIN pg_opclass op ON op.oid = i.indclass[0]
    LEFT JOIN pg_namespace ns ON ns.oid = op.opcnamespace
    LEFT JOIN pg_depend dep ON dep.classid = 'pg_opclass'::regclass AND dep.objid = op.oid
      AND dep.refclassid = 'pg_extension'::regclass
    LEFT JOIN pg_extension extension ON extension.oid = dep.refobjid
    WHERE c.oid = to_regclass(${`${quoteIdentifier(physical.schema)}.${quoteIdentifier(indexName)}`})
  `.execute(db);
  const index = rows.rows[0];
  if (!index) return { present: false, owned: false, ready: false };
  const identity = { oid: index.oid, foreignDependents: index.foreign_dependents };
  if (!index.owned || !index.expression)
    return { present: true, owned: false, ready: false, ...identity };
  // Plan both expressions in one relation context so PostgreSQL applies identical
  // qualification and casts without rewriting quoted identifiers or literals.
  const explained = await sql<{
    'QUERY PLAN': { Plan: { Output?: string[]; Plans?: { Output?: string[] }[] } }[];
  }>`
    EXPLAIN (VERBOSE, FORMAT JSON)
    SELECT ${sql.raw(buildIndexedSearchExpression(fields))}, ${sql.raw(index.expression)}
    FROM ${sql.raw(makePhysicalTableSql(physical.schema, physical.tableName))} LIMIT 0
  `.execute(db);
  const plan = explained.rows[0]?.['QUERY PLAN']?.[0]?.Plan;
  const output = plan?.Output ?? plan?.Plans?.[0]?.Output;
  const owned = output?.length === 2 && output[0] === output[1];
  return { present: true, owned, ready: owned && index.ready === true, ...identity };
};

export const createResidualSearchIndex = async (
  db: Kysely<UnknownPostgresDatabase>,
  physical: { readonly schema: string; readonly tableName: string },
  indexName: string,
  fields: readonly ResidualField[],
  provider: TableQuerySubstringSearchProviderCapability
): Promise<void> => {
  const existing = await inspectResidualSearchIndex(db, physical, indexName, fields, provider);
  if (existing.present && !existing.owned)
    throw new Error('Residual index name belongs to an incompatible physical object');
  if (existing.ready) return;
  if (existing.present)
    await sql
      .raw(
        `DROP INDEX CONCURRENTLY ${quoteIdentifier(physical.schema)}.${quoteIdentifier(indexName)}`
      )
      .execute(db);
  const operator = provider.operatorClassSchema
    ? `${quoteIdentifier(provider.operatorClassSchema)}.${quoteIdentifier(provider.operatorClass)}`
    : quoteIdentifier(provider.operatorClass);
  await sql
    .raw(
      `CREATE INDEX CONCURRENTLY ${quoteIdentifier(indexName)} ON ${makePhysicalTableSql(physical.schema, physical.tableName)} USING GIN ((${buildIndexedSearchExpression(fields)}) ${operator})`
    )
    .execute(db);
};
