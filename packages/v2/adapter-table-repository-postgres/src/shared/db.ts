import type { ISpan, ITracer, SpanAttributes } from '@teable/v2-core';
import type { Kysely, Transaction, CompiledQuery } from 'kysely';

import type { TableSchemaStatementBuilder } from '../schema/rules/core';
export {
  getPostgresTransaction,
  resolvePostgresDbOrTx,
} from '@teable/v2-adapter-db-postgres-shared';

type ExecuteQueryTraceOptions = {
  readonly tracer?: ITracer;
  readonly attributes?: SpanAttributes;
};

const schemaStatementSpanName = 'teable.postgres.schema_statement.execute';

const describeError = (error: unknown): string => {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
};

const normalizeSqlOperation = (sql: string): string => {
  const [first = 'unknown', second] = sql.trim().replace(/\s+/g, ' ').split(' ');
  if (!second) return first.toUpperCase();

  const normalizedFirst = first.toUpperCase();
  if (normalizedFirst === 'ALTER' || normalizedFirst === 'CREATE' || normalizedFirst === 'DROP') {
    return `${normalizedFirst} ${second.toUpperCase()}`;
  }

  return normalizedFirst;
};

const executeCompiledQuery = async <DB>(
  db: Kysely<DB> | Transaction<DB>,
  statement: CompiledQuery,
  statementIndex: number,
  statementCount: number,
  trace?: ExecuteQueryTraceOptions
): Promise<void> => {
  const tracer = trace?.tracer;
  if (!tracer) {
    await db.executeQuery(statement);
    return;
  }

  const attributes: SpanAttributes = {
    ...trace.attributes,
    'db.system': 'postgresql',
    'db.operation': normalizeSqlOperation(statement.sql),
    'teable.db.statement.index': statementIndex,
    'teable.db.statement.count': statementCount,
    'teable.db.statement.sql_bytes': statement.sql.length,
    'teable.db.statement.parameter_count': statement.parameters.length,
  };

  let span: ISpan;
  try {
    span = tracer.startSpan(schemaStatementSpanName, attributes);
  } catch {
    await db.executeQuery(statement);
    return;
  }

  const startedAt = Date.now();
  const execute = async () => {
    try {
      await db.executeQuery(statement);
    } catch (error) {
      span.recordError(describeError(error));
      throw error;
    } finally {
      span.setAttribute('teable.db.statement.duration_ms', Date.now() - startedAt);
    }
  };

  try {
    await tracer.withSpan(span, execute);
  } finally {
    span.end();
  }
};

export const executeCompiledQueries = async <DB>(
  db: Kysely<DB> | Transaction<DB>,
  compiled: ReadonlyArray<CompiledQuery>,
  trace?: ExecuteQueryTraceOptions
): Promise<void> => {
  for (const [index, statement] of compiled.entries()) {
    await executeCompiledQuery(db, statement, index, compiled.length, trace);
  }
};

export const executeTableSchemaStatements = async <DB>(
  db: Kysely<DB> | Transaction<DB>,
  statements: ReadonlyArray<TableSchemaStatementBuilder>,
  trace?: ExecuteQueryTraceOptions
): Promise<void> => {
  await executeCompiledQueries(
    db,
    statements.map((statement) => statement.compile(db)),
    trace
  );
};
