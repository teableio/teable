import type { ISpan, ITracer, SpanAttributes } from '@teable/v2-core';
import type { Kysely, Transaction, CompiledQuery, QueryResult } from 'kysely';

import type { TableSchemaStatementBuilder } from '../schema/rules/core';
import {
  assertSchemaStatementRelationAccess,
  findSchemaStatementRelationAccessViolations,
} from '../schema/rules/core';
export {
  getPostgresTransaction,
  resolvePostgresDbOrTx,
} from '@teable/v2-adapter-db-postgres-shared';

type ExecuteQueryTraceOptions = {
  readonly tracer?: ITracer;
  readonly attributes?: SpanAttributes;
  readonly enforceRelationAccess?: boolean;
  readonly dataDb?: Kysely<unknown> | Transaction<unknown>;
  readonly metaDb?: Kysely<unknown> | Transaction<unknown>;
};

type KyselyQueryExecutor = ReturnType<Kysely<unknown>['getExecutor']>;

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

const executeCustomTableSchemaStatement = async <DB>(
  db: Kysely<DB> | Transaction<DB>,
  statement: TableSchemaStatementBuilder,
  statementIndex: number,
  statementCount: number,
  trace?: ExecuteQueryTraceOptions
): Promise<void> => {
  const statementForScope = (
    scope: TableSchemaStatementBuilder['scope']
  ): TableSchemaStatementBuilder =>
    scope === statement.scope
      ? statement
      : {
          ...statement,
          scope,
        };
  const scopedExecutor = (
    executor: Kysely<unknown> | Transaction<unknown>,
    scope: TableSchemaStatementBuilder['scope']
  ): Kysely<unknown> | Transaction<unknown> => {
    if (!trace?.enforceRelationAccess) {
      return executor;
    }

    const scopedStatement = statementForScope(scope);
    const assertAccess = (compiledQuery: CompiledQuery) => {
      const violations = findSchemaStatementRelationAccessViolations(
        scopedStatement,
        compiledQuery
      );
      if (violations.length > 0) {
        assertSchemaStatementRelationAccess(scopedStatement, compiledQuery);
      }
    };
    const wrapExecutor = (executor: KyselyQueryExecutor): KyselyQueryExecutor =>
      new Proxy(executor, {
        get(target, prop, receiver) {
          if (prop === 'executeQuery') {
            return async <O>(compiledQuery: CompiledQuery): Promise<QueryResult<O>> => {
              assertAccess(compiledQuery);
              return target.executeQuery<O>(compiledQuery);
            };
          }

          const value = Reflect.get(target, prop, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });

    return new Proxy(executor, {
      get(target, prop, receiver) {
        if (prop === 'executeQuery') {
          return async <O>(compiledQuery: CompiledQuery): Promise<QueryResult<O>> => {
            assertAccess(compiledQuery);
            return target.executeQuery<O>(compiledQuery);
          };
        }
        if (prop === 'getExecutor') {
          return () => wrapExecutor(target.getExecutor());
        }

        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  };

  const execute = async () => {
    if (trace?.enforceRelationAccess) {
      assertSchemaStatementRelationAccess(statement, statement.compile(db));
    }

    await statement.execute?.({
      scopedDb: scopedExecutor(db as Kysely<unknown> | Transaction<unknown>, statement.scope),
      dataDb: scopedExecutor(
        (trace?.dataDb ?? db) as Kysely<unknown> | Transaction<unknown>,
        'data'
      ),
      metaDb: scopedExecutor(
        (trace?.metaDb ?? db) as Kysely<unknown> | Transaction<unknown>,
        'meta'
      ),
    });
  };

  const tracer = trace?.tracer;
  if (!tracer) {
    await execute();
    return;
  }

  let span: ISpan;
  try {
    span = tracer.startSpan(schemaStatementSpanName, {
      ...trace.attributes,
      'db.system': 'postgresql',
      'db.operation': 'CUSTOM',
      'teable.db.statement.index': statementIndex,
      'teable.db.statement.count': statementCount,
      'teable.db.statement.sql_bytes': 0,
      'teable.db.statement.parameter_count': 0,
    });
  } catch {
    await execute();
    return;
  }

  const startedAt = Date.now();
  try {
    await tracer.withSpan(span, async () => {
      try {
        await execute();
      } catch (error) {
        span.recordError(describeError(error));
        throw error;
      } finally {
        span.setAttribute('teable.db.statement.duration_ms', Date.now() - startedAt);
      }
    });
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
  for (const [index, statement] of statements.entries()) {
    if (statement.execute) {
      await executeCustomTableSchemaStatement(db, statement, index, statements.length, trace);
      continue;
    }

    const compiledQuery = statement.compile(db);
    if (trace?.enforceRelationAccess) {
      assertSchemaStatementRelationAccess(statement, compiledQuery);
    }
    await executeCompiledQuery(db, compiledQuery, index, statements.length, trace);
  }
};
