import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { Table } from '../domain/table/Table';
import type { IExecutionContext } from './ExecutionContext';
import type { UndoRedoFieldSnapshot } from './UndoRedoStore';

export type FieldDeleteSnapshotItem = {
  readonly table: Table;
  readonly snapshot: UndoRedoFieldSnapshot;
};

export type FieldDeleteSnapshotSinkInput = {
  readonly baseId: string;
  readonly tableId: string;
  readonly fieldIds: ReadonlyArray<string>;
  readonly snapshots: ReadonlyArray<FieldDeleteSnapshotItem>;
};

export interface IFieldDeleteSnapshotSinkCompletion {
  complete(context: IExecutionContext): Promise<Result<void, DomainError>>;
}

export interface IFieldDeleteSnapshotSink {
  prepare(
    context: IExecutionContext,
    input: FieldDeleteSnapshotSinkInput
  ): Promise<Result<IFieldDeleteSnapshotSinkCompletion | undefined, DomainError>>;
}
