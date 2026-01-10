import type { SchemaCheckResult } from '@teable/v2-adapter-table-repository-postgres';
import type { Effect } from 'effect';
import { Context } from 'effect';
import type { CliError } from '../errors';

/** Options for schema check */
export interface SchemaCheckOptions {
  /** Whether to show only errors (skip success results) */
  readonly errorsOnly?: boolean;
}

/** Summary of schema check results */
export interface SchemaCheckSummary {
  readonly total: number;
  readonly success: number;
  readonly errors: number;
  readonly warnings: number;
  readonly results: ReadonlyArray<SchemaCheckResult>;
}

export class SchemaChecker extends Context.Tag('SchemaChecker')<
  SchemaChecker,
  {
    /** Check all fields in a table */
    readonly checkTable: (
      tableId: string,
      options?: SchemaCheckOptions
    ) => Effect.Effect<SchemaCheckSummary, CliError>;

    /** Check a specific field */
    readonly checkField: (
      tableId: string,
      fieldId: string,
      options?: SchemaCheckOptions
    ) => Effect.Effect<SchemaCheckSummary, CliError>;
  }
>() {}
