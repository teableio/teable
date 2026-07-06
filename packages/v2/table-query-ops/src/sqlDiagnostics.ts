import type { IExecutionContext } from '@teable/v2-core';

import { stableHash, type TableQuerySqlDiagnostic } from './domain';

export const TABLE_QUERY_SQL_DIAGNOSTICS_CONTEXT_KEY = Symbol.for(
  'teable.v2.tableOps.sqlDiagnostics'
);

export type TableQuerySqlDiagnosticsConfig = {
  readonly captureSqlSample: boolean;
  readonly maxSampleLength: number;
  readonly maxDiagnosticsPerObservation: number;
};

export const defaultTableQuerySqlDiagnosticsConfig: TableQuerySqlDiagnosticsConfig = {
  captureSqlSample: false,
  maxSampleLength: 2000,
  maxDiagnosticsPerObservation: 4,
};

export type RawTableQuerySqlDiagnostic = {
  readonly source: string;
  readonly sql: string;
  readonly parameters?: ReadonlyArray<unknown>;
};

export type TableQuerySqlDiagnosticsCollector = {
  readonly record: (input: RawTableQuerySqlDiagnostic) => void;
  readonly snapshot: () => ReadonlyArray<TableQuerySqlDiagnostic>;
};

type SqlDiagnosticsContext = IExecutionContext & {
  [TABLE_QUERY_SQL_DIAGNOSTICS_CONTEXT_KEY]?: TableQuerySqlDiagnosticsCollector;
};

export const createTableQuerySqlDiagnosticsCollector = (
  config: Partial<TableQuerySqlDiagnosticsConfig> = {}
): TableQuerySqlDiagnosticsCollector => {
  const resolved = {
    ...defaultTableQuerySqlDiagnosticsConfig,
    ...config,
  };
  const diagnostics: TableQuerySqlDiagnostic[] = [];

  return {
    record(input) {
      if (diagnostics.length >= resolved.maxDiagnosticsPerObservation) {
        return;
      }
      const normalizedSql = normalizeSql(input.sql);
      if (!normalizedSql) {
        return;
      }
      const diagnostic: TableQuerySqlDiagnostic = {
        source: input.source,
        statementKind: statementKind(normalizedSql),
        fingerprint: stableHash(normalizedSql),
        parameterCount: input.parameters?.length ?? 0,
        sampled: resolved.captureSqlSample,
        normalizedSql: resolved.captureSqlSample
          ? truncateSql(normalizedSql, resolved.maxSampleLength)
          : undefined,
      };
      diagnostics.push(diagnostic);
    },
    snapshot() {
      return diagnostics;
    },
  };
};

export const attachTableQuerySqlDiagnosticsCollector = (
  context: IExecutionContext,
  config?: Partial<TableQuerySqlDiagnosticsConfig>
): {
  readonly collector: TableQuerySqlDiagnosticsCollector;
  readonly restore: () => void;
} => {
  const diagnosticsContext = context as SqlDiagnosticsContext;
  const previous = diagnosticsContext[TABLE_QUERY_SQL_DIAGNOSTICS_CONTEXT_KEY];
  const collector = createTableQuerySqlDiagnosticsCollector(config);
  diagnosticsContext[TABLE_QUERY_SQL_DIAGNOSTICS_CONTEXT_KEY] = collector;

  return {
    collector,
    restore() {
      if (previous) {
        diagnosticsContext[TABLE_QUERY_SQL_DIAGNOSTICS_CONTEXT_KEY] = previous;
      } else {
        delete diagnosticsContext[TABLE_QUERY_SQL_DIAGNOSTICS_CONTEXT_KEY];
      }
    },
  };
};

const normalizeSql = (sql: string): string =>
  sql
    .replace(/--.*$/gm, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const statementKind = (sql: string): string => sql.match(/^[a-z]+/i)?.[0]?.toLowerCase() ?? 'sql';

const truncateSql = (sql: string, maxLength: number): string =>
  sql.length <= maxLength ? sql : `${sql.slice(0, Math.max(0, maxLength - 3))}...`;
