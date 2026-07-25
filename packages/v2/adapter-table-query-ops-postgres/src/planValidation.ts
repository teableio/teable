import { type DomainError, type IExecutionContext, type Table } from '@teable/v2-core';
import {
  TableQueryPlanValidation,
  type TableQueryIndexInspection,
  type TableQueryObservationWindow,
  type TableQueryPlanValidationInput,
  type TableQueryPlanValidator,
} from '@teable/v2-table-query-ops';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { ok, type Result } from 'neverthrow';

import { getTablePhysicalName, makePhysicalTableSql, quoteIdentifier } from './helpers';
import type { UnknownPostgresDatabase } from './types';

type ExplainPlan = {
  readonly startupCost?: number;
  readonly totalCost?: number;
  readonly nodeType?: string;
  readonly indexName?: string;
  readonly rawPlan?: unknown;
};

type ExplainRow = {
  readonly 'QUERY PLAN': unknown;
};

type MissingIndexCandidate = ReturnType<
  TableQueryIndexInspection['snapshot']
>['missingIndexCandidates'][number];

export class PostgresTableQueryPlanValidator implements TableQueryPlanValidator {
  constructor(private readonly dataDb: Kysely<UnknownPostgresDatabase>) {}

  async validate(
    _context: IExecutionContext,
    input: {
      readonly table: Table;
      readonly observation: TableQueryObservationWindow;
      readonly indexInspection: TableQueryIndexInspection;
    }
  ): Promise<Result<TableQueryPlanValidation, DomainError>> {
    const candidates = input.indexInspection.snapshot().missingIndexCandidates;
    const normalizedSql = getNormalizedSql(input.observation);
    if (!normalizedSql) {
      return createPlanValidation({
        status: 'skipped',
        reason: 'normalized_sql_sample_missing',
        candidateCount: candidates.length,
      });
    }
    const safety = validateExplainSql(normalizedSql);
    if (safety) {
      return createPlanValidation({
        status: 'skipped',
        reason: safety,
        candidateCount: candidates.length,
      });
    }

    const physical = getTablePhysicalName(input.table);
    if (physical.isErr()) {
      return createPlanValidation({
        status: 'failed',
        reason: 'physical_table_name_failed',
        candidateCount: candidates.length,
        errors: [physical.error.message],
      });
    }

    try {
      return ok(
        await this.dataDb.connection().execute(async (db) => {
          const before = await explain(db, normalizedSql);
          const indexStatements = candidates
            .map((candidate) =>
              buildHypotheticalIndexStatement(
                physical.value.schema,
                physical.value.tableName,
                candidate
              )
            )
            .filter((statement): statement is string => Boolean(statement));

          if (indexStatements.length === 0) {
            return createPlanValidation({
              status: 'validated',
              method: 'explain',
              reason: 'no_hypothetical_index_candidates',
              candidateCount: candidates.length,
              startupCostBefore: before.startupCost,
              totalCostBefore: before.totalCost,
              planNodeBefore: before.nodeType,
            })._unsafeUnwrap();
          }

          const hypopgSchema = await readHypopgSchema(db);
          if (!hypopgSchema) {
            return createPlanValidation({
              status: 'validated',
              method: 'explain',
              reason: 'hypopg_extension_unavailable',
              candidateCount: candidates.length,
              startupCostBefore: before.startupCost,
              totalCostBefore: before.totalCost,
              planNodeBefore: before.nodeType,
              indexStatements,
            })._unsafeUnwrap();
          }

          await resetHypopg(db, hypopgSchema);
          for (const statement of indexStatements) {
            await sql`
              SELECT * FROM ${sql.raw(quoteIdentifier(hypopgSchema))}.hypopg_create_index(${statement})
            `.execute(db);
          }
          const after = await explain(db, normalizedSql);
          await resetHypopg(db, hypopgSchema);

          return createPlanValidation({
            status: 'validated',
            method: 'hypothetical_index',
            candidateCount: candidates.length,
            startupCostBefore: before.startupCost,
            startupCostAfter: after.startupCost,
            totalCostBefore: before.totalCost,
            totalCostAfter: after.totalCost,
            planNodeBefore: before.nodeType,
            planNodeAfter: after.nodeType,
            usesCandidateIndex:
              Boolean(after.indexName) || planReferencesHypotheticalIndex(after.rawPlan),
            indexStatements,
          })._unsafeUnwrap();
        })
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return createPlanValidation({
        status: 'failed',
        reason: 'explain_failed',
        candidateCount: candidates.length,
        errors: [message],
      });
    }
  }
}

const createPlanValidation = (
  input: TableQueryPlanValidationInput
): Result<TableQueryPlanValidation, DomainError> => TableQueryPlanValidation.create(input);

const getNormalizedSql = (observation: TableQueryObservationWindow): string | undefined =>
  observation
    .snapshot()
    .sqlDiagnostics?.find((diagnostic) => diagnostic.normalizedSql?.trim())
    ?.normalizedSql?.trim();

const validateExplainSql = (statement: string): string | undefined => {
  const trimmed = statement.trim();
  if (trimmed.includes(';')) return 'multi_statement_sql_unsupported';
  if (!/^(?:select|with)\b/i.test(trimmed)) return 'non_select_sql_unsupported';
  if (/\$\d+\b/.test(trimmed)) return 'parameterized_sql_unsupported';
  return undefined;
};

const explain = async (
  db: Kysely<UnknownPostgresDatabase>,
  statement: string
): Promise<ExplainPlan> => {
  const rows = await sql<ExplainRow>`
    EXPLAIN (FORMAT JSON) ${sql.raw(statement)}
  `.execute(db);
  return parseExplainPlan(rows.rows[0]?.['QUERY PLAN']);
};

const parseExplainPlan = (value: unknown): ExplainPlan => {
  const root = Array.isArray(value) ? value[0] : value;
  const plan = root && typeof root === 'object' ? (root as { Plan?: unknown }).Plan : undefined;
  if (!plan || typeof plan !== 'object') {
    return { rawPlan: value };
  }
  const typed = plan as Record<string, unknown>;
  return {
    startupCost: toNumber(typed['Startup Cost']),
    totalCost: toNumber(typed['Total Cost']),
    nodeType: typeof typed['Node Type'] === 'string' ? typed['Node Type'] : undefined,
    indexName: findFirstIndexName(plan),
    rawPlan: value,
  };
};

const findFirstIndexName = (value: unknown): string | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstIndexName(item);
      if (found) return found;
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (typeof record['Index Name'] === 'string') return record['Index Name'];
  for (const child of Object.values(record)) {
    const found = findFirstIndexName(child);
    if (found) return found;
  }
  return undefined;
};

const planReferencesHypotheticalIndex = (value: unknown): boolean => {
  if (typeof value === 'string') return value.includes('<') && value.includes('>');
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(planReferencesHypotheticalIndex);
  return Object.values(value as Record<string, unknown>).some(planReferencesHypotheticalIndex);
};

const toNumber = (value: unknown): number | undefined => {
  const numberValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
};

const readHypopgSchema = async (
  db: Kysely<UnknownPostgresDatabase>
): Promise<string | undefined> => {
  const result = await sql<{ schema_name: string }>`
    SELECT n.nspname AS schema_name
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'hypopg_create_index'
    LIMIT 1
  `.execute(db);
  return result.rows[0]?.schema_name;
};

const resetHypopg = async (db: Kysely<UnknownPostgresDatabase>, schema: string): Promise<void> => {
  await sql`SELECT ${sql.raw(quoteIdentifier(schema))}.hypopg_reset()`.execute(db);
};

const buildHypotheticalIndexStatement = (
  schema: string,
  tableName: string,
  candidate: MissingIndexCandidate
): string | undefined => {
  const fields =
    candidate.fields?.filter((field) => field.fieldDbName) ??
    (candidate.fieldDbName ? [{ fieldDbName: candidate.fieldDbName }] : []);
  if (fields.length === 0) return undefined;
  const tableSql = makePhysicalTableSql(schema, tableName);
  if (candidate.kind === 'gin_trgm') {
    const fieldSql = quoteIdentifier(fields[0]?.fieldDbName ?? '');
    return `CREATE INDEX ON ${tableSql} USING gin (${fieldSql} gin_trgm_ops)`;
  }
  if (candidate.kind === 'btree') {
    const fieldSql = fields
      .map((field) => {
        const direction = field.direction ? ` ${field.direction.toUpperCase()}` : '';
        return `${quoteIdentifier(field.fieldDbName ?? '')}${direction}`;
      })
      .join(', ');
    return `CREATE INDEX ON ${tableSql} USING btree (${fieldSql})`;
  }
  return undefined;
};
