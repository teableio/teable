/**
 * Options for the explain operation.
 */
export type ExplainOptions = {
  /**
   * If true, run EXPLAIN ANALYZE (executes in transaction then rollback).
   * @default false
   */
  readonly analyze?: boolean;

  /**
   * If true, include generated SQL in the result.
   * @default true
   */
  readonly includeSql?: boolean;

  /**
   * If true, include detailed dependency graph edges.
   * @default true
   */
  readonly includeGraph?: boolean;

  /**
   * If true, include computed update lock information.
   * @default true
   */
  readonly includeLocks?: boolean;

  /**
   * How generated SQL should be handled.
   * - json: run PostgreSQL EXPLAIN FORMAT JSON and parse plan summary.
   * - text: run PostgreSQL EXPLAIN in text format and keep raw lines.
   * - dump: include generated SQL without running EXPLAIN.
   * @default 'json'
   */
  readonly sqlExplainMode?: 'json' | 'text' | 'dump';

  /**
   * Optional PostgreSQL statement_timeout for SQL EXPLAIN calls, in milliseconds.
   */
  readonly statementTimeoutMs?: number;
};

/**
 * Default options for explain.
 */
export const DEFAULT_EXPLAIN_OPTIONS: Required<ExplainOptions> = {
  analyze: false,
  includeSql: true,
  includeGraph: true,
  includeLocks: true,
  sqlExplainMode: 'json',
  statementTimeoutMs: 0,
};
