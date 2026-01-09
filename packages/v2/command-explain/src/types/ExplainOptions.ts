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
};

/**
 * Default options for explain.
 */
export const DEFAULT_EXPLAIN_OPTIONS: Required<ExplainOptions> = {
  analyze: false,
  includeSql: true,
  includeGraph: true,
  includeLocks: true,
};
