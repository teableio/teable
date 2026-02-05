import type { Result } from 'neverthrow';

import type { ActorId } from '../domain/shared/ActorId';
import type { DomainError } from '../domain/shared/DomainError';
import type { TableId } from '../domain/table/TableId';

export type UndoScope = {
  readonly actorId: ActorId;
  readonly tableId: TableId;
  readonly windowId: string;
};

export type UndoRedoUpdateRecordPayload = {
  readonly tableId: string;
  readonly recordId: string;
  readonly fields: Record<string, unknown>;
  readonly fieldKeyType: 'id';
  readonly typecast: boolean;
};

export type UndoRedoDeleteRecordsPayload = {
  readonly tableId: string;
  readonly recordIds: ReadonlyArray<string>;
};

export type UndoRedoRestoreRecord = {
  readonly recordId: string;
  readonly fields: Record<string, unknown>;
  readonly orders?: Record<string, number>;
  readonly autoNumber?: number;
  readonly createdTime?: string;
  readonly createdBy?: string;
  readonly lastModifiedTime?: string;
  readonly lastModifiedBy?: string;
};

export type UndoRedoRestoreRecordsPayload = {
  readonly tableId: string;
  readonly records: ReadonlyArray<UndoRedoRestoreRecord>;
};

export type UndoRedoCommandLeafType = 'UpdateRecord' | 'DeleteRecords' | 'RestoreRecords';

export type UndoRedoCommandType = UndoRedoCommandLeafType | 'Batch';

export type UndoRedoUpdateCommandData = {
  readonly type: 'UpdateRecord';
  readonly version: number;
  readonly payload: UndoRedoUpdateRecordPayload;
};

export type UndoRedoDeleteRecordsCommandData = {
  readonly type: 'DeleteRecords';
  readonly version: number;
  readonly payload: UndoRedoDeleteRecordsPayload;
};

export type UndoRedoRestoreRecordsCommandData = {
  readonly type: 'RestoreRecords';
  readonly version: number;
  readonly payload: UndoRedoRestoreRecordsPayload;
};

export type UndoRedoCommandLeafData =
  | UndoRedoUpdateCommandData
  | UndoRedoDeleteRecordsCommandData
  | UndoRedoRestoreRecordsCommandData;

export type UndoRedoBatchCommandData = {
  readonly type: 'Batch';
  readonly version: number;
  readonly payload: ReadonlyArray<UndoRedoCommandLeafData>;
};

export type UndoRedoCommandData = UndoRedoCommandLeafData | UndoRedoBatchCommandData;

export type UndoEntry = {
  readonly scope: UndoScope;
  readonly undoCommand: UndoRedoCommandData;
  readonly redoCommand: UndoRedoCommandData;
  readonly recordVersionBefore?: number;
  readonly recordVersionAfter?: number;
  readonly createdAt: string;
  readonly requestId?: string;
};

export type UndoRedoListOptions = {
  readonly offset?: number;
  readonly limit?: number;
};

export interface IUndoRedoStore {
  append(scope: UndoScope, entry: UndoEntry): Promise<Result<void, DomainError>>;
  undo(scope: UndoScope): Promise<Result<UndoEntry | null, DomainError>>;
  redo(scope: UndoScope): Promise<Result<UndoEntry | null, DomainError>>;
  list(
    scope: UndoScope,
    options?: UndoRedoListOptions
  ): Promise<Result<ReadonlyArray<UndoEntry>, DomainError>>;
}
