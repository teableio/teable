import type { SchemaOperationStatus, SchemaOperationType } from '@teable/v2-core';
import type { Effect } from 'effect';
import { Context } from 'effect';
import type { CliError } from '../errors';

export interface SchemaOperationTable<Row> {
  readonly columns: ReadonlyArray<keyof Row & string>;
  readonly rows: ReadonlyArray<Row>;
}

export interface SchemaOperationRow {
  readonly id: string;
  readonly type: string;
  readonly status: string;
  readonly phase: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly baseId: string | null;
  readonly tableId: string | null;
  readonly idempotencyKey: string;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly nextRunAt: string;
  readonly lockedAt: string | null;
  readonly lockedBy: string | null;
  readonly lastError: string | null;
  readonly createdAt: string;
  readonly updatedAt: string | null;
}

export interface ListSchemaOperationsInput {
  readonly statuses?: ReadonlyArray<SchemaOperationStatus>;
  readonly types?: ReadonlyArray<SchemaOperationType>;
  readonly baseIds?: ReadonlyArray<string>;
  readonly tableIds?: ReadonlyArray<string>;
  readonly resourceIds?: ReadonlyArray<string>;
  readonly limit?: number;
  readonly offset?: number;
}

export interface ListSchemaOperationsOutput {
  readonly snapshotAt: string;
  readonly scope: {
    readonly statuses: ReadonlyArray<SchemaOperationStatus>;
    readonly types?: ReadonlyArray<SchemaOperationType>;
    readonly baseIds?: ReadonlyArray<string>;
    readonly tableIds?: ReadonlyArray<string>;
    readonly resourceIds?: ReadonlyArray<string>;
    readonly limit: number;
    readonly offset: number;
  };
  readonly total: number;
  readonly operationTable: SchemaOperationTable<SchemaOperationRow>;
  readonly notes: ReadonlyArray<string>;
}

export interface SchemaOperationSelectorInput {
  readonly operationId?: string;
  readonly idempotencyKey?: string;
}

export interface RetrySchemaOperationInput extends SchemaOperationSelectorInput {
  readonly resetAttempts?: boolean;
  readonly lastError?: string | null;
}

export interface RetrySchemaOperationOutput {
  readonly operation: SchemaOperationRow;
  readonly resetAttempts: boolean;
  readonly notes: ReadonlyArray<string>;
}

export interface MarkSchemaOperationDeadInput extends SchemaOperationSelectorInput {
  readonly reason?: string | null;
}

export interface MarkSchemaOperationDeadOutput {
  readonly operation: SchemaOperationRow;
  readonly notes: ReadonlyArray<string>;
}

export class SchemaOperationControl extends Context.Tag('SchemaOperationControl')<
  SchemaOperationControl,
  {
    readonly listOperations: (
      input: ListSchemaOperationsInput
    ) => Effect.Effect<ListSchemaOperationsOutput, CliError>;
    readonly retryOperation: (
      input: RetrySchemaOperationInput
    ) => Effect.Effect<RetrySchemaOperationOutput, CliError>;
    readonly markDeadOperation: (
      input: MarkSchemaOperationDeadInput
    ) => Effect.Effect<MarkSchemaOperationDeadOutput, CliError>;
  }
>() {}
