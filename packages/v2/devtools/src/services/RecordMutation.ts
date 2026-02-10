import type { Effect } from 'effect';
import { Context } from 'effect';
import type { CliError } from '../errors';

export interface CreateRecordInput {
  readonly tableId: string;
  readonly fields: Record<string, unknown>;
  readonly typecast?: boolean;
}

export interface CreateRecordOutput {
  readonly recordId: string;
  readonly fields: Record<string, unknown>;
}

export interface UpdateRecordInput {
  readonly tableId: string;
  readonly recordId: string;
  readonly fields: Record<string, unknown>;
  readonly typecast?: boolean;
}

export interface UpdateRecordOutput {
  readonly recordId: string;
  readonly fields: Record<string, unknown>;
}

export interface DeleteRecordsInput {
  readonly tableId: string;
  readonly recordIds: readonly string[];
}

export interface DeleteRecordsOutput {
  readonly deletedCount: number;
  readonly deletedRecordIds: readonly string[];
}

export class RecordMutation extends Context.Tag('RecordMutation')<
  RecordMutation,
  {
    readonly createRecord: (
      input: CreateRecordInput
    ) => Effect.Effect<CreateRecordOutput, CliError>;
    readonly updateRecord: (
      input: UpdateRecordInput
    ) => Effect.Effect<UpdateRecordOutput, CliError>;
    readonly deleteRecords: (
      input: DeleteRecordsInput
    ) => Effect.Effect<DeleteRecordsOutput, CliError>;
  }
>() {}
