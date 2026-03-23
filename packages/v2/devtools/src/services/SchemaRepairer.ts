import type { SchemaRepairResult } from '@teable/v2-adapter-table-repository-postgres';
import type { Effect } from 'effect';
import { Context } from 'effect';
import type { CliError } from '../errors';

export interface SchemaRepairOptions {
  readonly dryRun?: boolean;
}

export interface SchemaRepairSummary {
  readonly total: number;
  readonly repaired: number;
  readonly unchanged: number;
  readonly manual: number;
  readonly skipped: number;
  readonly errors: number;
  readonly results: ReadonlyArray<SchemaRepairResult>;
}

export class SchemaRepairer extends Context.Tag('SchemaRepairer')<
  SchemaRepairer,
  {
    readonly repairTable: (
      tableId: string,
      options?: SchemaRepairOptions
    ) => Effect.Effect<SchemaRepairSummary, CliError>;

    readonly repairField: (
      tableId: string,
      fieldId: string,
      options?: SchemaRepairOptions
    ) => Effect.Effect<SchemaRepairSummary, CliError>;

    readonly repairRule: (
      tableId: string,
      fieldId: string,
      ruleId: string,
      options?: SchemaRepairOptions
    ) => Effect.Effect<SchemaRepairSummary, CliError>;
  }
>() {}
