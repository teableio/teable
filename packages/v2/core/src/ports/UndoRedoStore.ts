import type { Result } from 'neverthrow';

import type { ActorId } from '../domain/shared/ActorId';
import type { DomainError } from '../domain/shared/DomainError';
import type { TableId } from '../domain/table/TableId';
import type { ViewColumnMetaValue } from '../domain/table/views/ViewColumnMeta';
import type { ViewQueryDefaultsDTO } from '../domain/table/views/ViewQueryDefaults';
import type { ITableFieldInput } from '../schemas/field';

/**
 * Identifies a single user interaction stack.
 *
 * Undo/redo history is isolated per actor + table + browser window instead of
 * being a global persistence log.
 */
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

export type UndoRedoUpdateRecordsPayload = {
  readonly tableId: string;
  readonly records: ReadonlyArray<{
    readonly id: string;
    readonly fields: Record<string, unknown>;
  }>;
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
  readonly version?: number;
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

export type UndoRedoApplyRecordOrdersPayload = {
  readonly tableId: string;
  readonly viewId: string;
  readonly records: ReadonlyArray<{
    readonly recordId: string;
    readonly order?: number | null;
  }>;
};

export type UndoRedoDeleteFieldPayload = {
  readonly baseId: string;
  readonly tableId: string;
  readonly fieldId: string;
};

export type UndoRedoFieldViewSnapshot = {
  readonly viewId: string;
  readonly columnMeta?: ViewColumnMetaValue[string] | null;
  readonly query?: ViewQueryDefaultsDTO;
  readonly orderedFieldIds?: ReadonlyArray<string>;
};

export type UndoRedoFieldRecordValue = {
  readonly recordId: string;
  readonly value: unknown;
};

export type UndoRedoFieldSnapshot = {
  readonly field: ITableFieldInput & { readonly id: string };
  readonly hasError?: boolean;
  readonly views: ReadonlyArray<UndoRedoFieldViewSnapshot>;
  readonly records?: ReadonlyArray<UndoRedoFieldRecordValue>;
};

export type UndoRedoApplyFieldSnapshotPayload = {
  readonly baseId: string;
  readonly tableId: string;
  readonly snapshot: UndoRedoFieldSnapshot;
};

export type UndoRedoReplayFieldTypeConversionPayload = {
  readonly baseId: string;
  readonly tableId: string;
  readonly snapshot: UndoRedoFieldSnapshot;
};

export type UndoRedoCommandLeafType =
  | 'UpdateRecord'
  | 'UpdateRecords'
  | 'DeleteRecords'
  | 'RestoreRecords'
  | 'ApplyRecordOrders'
  | 'DeleteField'
  | 'ApplyFieldSnapshot'
  | 'ReplayFieldTypeConversion';

export type UndoRedoCommandType = UndoRedoCommandLeafType | 'Batch';

export const undoRedoCommandVersions = {
  UpdateRecord: 1,
  UpdateRecords: 1,
  DeleteRecords: 1,
  RestoreRecords: 1,
  ApplyRecordOrders: 1,
  DeleteField: 1,
  ApplyFieldSnapshot: 1,
  ReplayFieldTypeConversion: 1,
  Batch: 1,
} as const satisfies Record<UndoRedoCommandType, number>;

export type UndoRedoUpdateCommandData = {
  readonly type: 'UpdateRecord';
  readonly version: number;
  readonly payload: UndoRedoUpdateRecordPayload;
};

export type UndoRedoUpdateRecordsCommandData = {
  readonly type: 'UpdateRecords';
  readonly version: number;
  readonly payload: UndoRedoUpdateRecordsPayload;
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

export type UndoRedoApplyRecordOrdersCommandData = {
  readonly type: 'ApplyRecordOrders';
  readonly version: number;
  readonly payload: UndoRedoApplyRecordOrdersPayload;
};

export type UndoRedoDeleteFieldCommandData = {
  readonly type: 'DeleteField';
  readonly version: number;
  readonly payload: UndoRedoDeleteFieldPayload;
};

export type UndoRedoApplyFieldSnapshotCommandData = {
  readonly type: 'ApplyFieldSnapshot';
  readonly version: number;
  readonly payload: UndoRedoApplyFieldSnapshotPayload;
};

export type UndoRedoReplayFieldTypeConversionCommandData = {
  readonly type: 'ReplayFieldTypeConversion';
  readonly version: number;
  readonly payload: UndoRedoReplayFieldTypeConversionPayload;
};

export type UndoRedoCommandLeafData =
  | UndoRedoUpdateCommandData
  | UndoRedoUpdateRecordsCommandData
  | UndoRedoDeleteRecordsCommandData
  | UndoRedoRestoreRecordsCommandData
  | UndoRedoApplyRecordOrdersCommandData
  | UndoRedoDeleteFieldCommandData
  | UndoRedoApplyFieldSnapshotCommandData
  | UndoRedoReplayFieldTypeConversionCommandData;

export type UndoRedoBatchCommandData = {
  readonly type: 'Batch';
  readonly version: number;
  readonly payload: ReadonlyArray<UndoRedoCommandLeafData>;
};

export type UndoRedoCommandData = UndoRedoCommandLeafData | UndoRedoBatchCommandData;

export type UndoRedoCommandPayloadByType = {
  UpdateRecord: UndoRedoUpdateRecordPayload;
  UpdateRecords: UndoRedoUpdateRecordsPayload;
  DeleteRecords: UndoRedoDeleteRecordsPayload;
  RestoreRecords: UndoRedoRestoreRecordsPayload;
  ApplyRecordOrders: UndoRedoApplyRecordOrdersPayload;
  DeleteField: UndoRedoDeleteFieldPayload;
  ApplyFieldSnapshot: UndoRedoApplyFieldSnapshotPayload;
  ReplayFieldTypeConversion: UndoRedoReplayFieldTypeConversionPayload;
  Batch: ReadonlyArray<UndoRedoCommandLeafData>;
};

export type UndoRedoCommandDataByType = {
  UpdateRecord: UndoRedoUpdateCommandData;
  UpdateRecords: UndoRedoUpdateRecordsCommandData;
  DeleteRecords: UndoRedoDeleteRecordsCommandData;
  RestoreRecords: UndoRedoRestoreRecordsCommandData;
  ApplyRecordOrders: UndoRedoApplyRecordOrdersCommandData;
  DeleteField: UndoRedoDeleteFieldCommandData;
  ApplyFieldSnapshot: UndoRedoApplyFieldSnapshotCommandData;
  ReplayFieldTypeConversion: UndoRedoReplayFieldTypeConversionCommandData;
  Batch: UndoRedoBatchCommandData;
};

const normalizeUpdateRecordFields = (fields: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(fields).map(([fieldId, value]) => [fieldId, value === undefined ? null : value])
  );

const normalizeUpdateRecordsPayload = (
  payload: UndoRedoUpdateRecordsPayload
): UndoRedoUpdateRecordsPayload => ({
  ...payload,
  records: payload.records.map((record) => ({
    ...record,
    fields: normalizeUpdateRecordFields(record.fields),
  })),
});

export const createUndoRedoCommand = <TType extends UndoRedoCommandType>(
  type: TType,
  payload: UndoRedoCommandPayloadByType[TType]
): UndoRedoCommandDataByType[TType] => {
  const normalizedPayload =
    type === 'UpdateRecord'
      ? ({
          ...(payload as UndoRedoUpdateRecordPayload),
          fields: normalizeUpdateRecordFields((payload as UndoRedoUpdateRecordPayload).fields),
        } as UndoRedoCommandPayloadByType[TType])
      : type === 'UpdateRecords'
        ? (normalizeUpdateRecordsPayload(
            payload as UndoRedoUpdateRecordsPayload
          ) as UndoRedoCommandPayloadByType[TType])
        : payload;

  return {
    type,
    version: undoRedoCommandVersions[type],
    payload: normalizedPayload,
  } as UndoRedoCommandDataByType[TType];
};

export const isSupportedUndoRedoCommandVersion = (command: UndoRedoCommandData): boolean =>
  command.version === undoRedoCommandVersions[command.type];

export const composeUndoRedoCommands = (
  commands: ReadonlyArray<UndoRedoCommandLeafData>
): UndoRedoCommandData =>
  commands.length === 1 ? commands[0]! : createUndoRedoCommand('Batch', commands);

export const flattenUndoRedoCommands = (
  command: UndoRedoCommandData
): ReadonlyArray<UndoRedoCommandLeafData> =>
  command.type === 'Batch' ? command.payload : [command];

export type UndoEntry = {
  readonly scope: UndoScope;
  readonly undoCommand: UndoRedoCommandData;
  readonly redoCommand: UndoRedoCommandData;
  readonly groupId?: string;
  readonly recordVersionBefore?: number;
  readonly recordVersionAfter?: number;
  readonly createdAt: string;
  readonly requestId?: string;
};

export type UndoRedoListOptions = {
  readonly offset?: number;
  readonly limit?: number;
};

/**
 * Storage for the per-window undo/redo interaction stack.
 *
 * Repository adapters capture record snapshots separately; this port only
 * stores and replays already-built stack entries.
 */
export interface IUndoRedoStore {
  append(scope: UndoScope, entry: UndoEntry): Promise<Result<void, DomainError>>;
  undo(scope: UndoScope): Promise<Result<UndoEntry | null, DomainError>>;
  redo(scope: UndoScope): Promise<Result<UndoEntry | null, DomainError>>;
  list(
    scope: UndoScope,
    options?: UndoRedoListOptions
  ): Promise<Result<ReadonlyArray<UndoEntry>, DomainError>>;
}
