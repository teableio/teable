import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import type { RecordCreateSource } from '../domain/table/events/RecordFieldValuesDTO';
import type { FieldId } from '../domain/table/fields/FieldId';
import type { FieldKeyType } from '../domain/table/fields/FieldKeyType';
import type { RecordId } from '../domain/table/records/RecordId';
import type { RecordInsertOrder } from '../domain/table/records/RecordInsertOrder';
import type { ITableRecordConditionSpecVisitor } from '../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import type { TableRecord } from '../domain/table/records/TableRecord';
import type { Table } from '../domain/table/Table';
import type { IExecutionContext } from './ExecutionContext';
import type { SourceColumnMap } from './import/IImportSource';
import type { PluginTraceContext } from './Tracer';

export const RecordWriteOperationKind = {
  createOne: 'createOne',
  createMany: 'createMany',
  createStream: 'createStream',
  submit: 'submit',
  duplicate: 'duplicate',
  duplicateStream: 'duplicateStream',
  updateOne: 'updateOne',
  updateMany: 'updateMany',
  deleteMany: 'deleteMany',
  importAppend: 'importAppend',
  paste: 'paste',
} as const;

export type RecordWriteOperationKind =
  (typeof RecordWriteOperationKind)[keyof typeof RecordWriteOperationKind];

export const recordWriteOperationMayCreateRecords = (
  operation: RecordWriteOperationKind
): boolean => {
  return (
    operation === RecordWriteOperationKind.createOne ||
    operation === RecordWriteOperationKind.createMany ||
    operation === RecordWriteOperationKind.createStream ||
    operation === RecordWriteOperationKind.submit ||
    operation === RecordWriteOperationKind.duplicate ||
    operation === RecordWriteOperationKind.duplicateStream ||
    operation === RecordWriteOperationKind.importAppend ||
    operation === RecordWriteOperationKind.paste
  );
};

export type RecordWritePluginEnforce = 'pre' | 'post';
export type RecordWriteFieldValues = ReadonlyMap<string, unknown>;
export type RecordWritePluginExecutionMode = 'direct' | 'stream';
export type RecordWritePluginExecutionScope = 'operation' | 'chunk';

export interface RecordWritePluginOrchestration {
  /**
   * High-level transport/execution mode. `stream` means the public API is
   * streaming progress while persistence may still happen chunk-by-chunk.
   */
  readonly mode: RecordWritePluginExecutionMode;
  /**
   * Whether the current hook invocation covers the whole logical operation or
   * a single chunk within a larger streamed operation.
   */
  readonly scope: RecordWritePluginExecutionScope;
  /** Stable identifier shared by all hook invocations for the same operation. */
  readonly operationId: string;
  /** Total target record count for the full logical operation. */
  readonly totalRecordCount: number;
  /** Total chunk count when the operation is chunked. */
  readonly totalChunkCount?: number;
  /** Zero-based chunk index when `scope === 'chunk'`. */
  readonly chunkIndex?: number;
}

type RecordWritePluginHookResult<T> = Result<T, DomainError> | Promise<Result<T, DomainError>>;

interface IRecordWritePluginContextBase<TKind extends RecordWriteOperationKind, TPayload> {
  readonly kind: TKind;
  readonly executionContext: IExecutionContext;
  readonly table: Table;
  readonly payload: TPayload;
  /**
   * Optional execution metadata for operations whose public API semantics differ
   * from the concrete hook invocation boundary, such as streamed chunk execution.
   */
  readonly orchestration?: RecordWritePluginOrchestration;
  readonly trace?: PluginTraceContext;
  readonly isTransactionBound: boolean;
}

export type RecordWriteCreateOnePayload = {
  readonly fieldValues: RecordWriteFieldValues;
  readonly fieldKeyType: FieldKeyType;
  readonly typecast: boolean;
  readonly source: RecordCreateSource;
  readonly order?: RecordInsertOrder;
  readonly recordCount: 1;
};

export type RecordWriteCreateManyPayload = {
  readonly recordsFieldValues: ReadonlyArray<RecordWriteFieldValues>;
  readonly fieldKeyType: FieldKeyType;
  readonly typecast: boolean;
  readonly order?: RecordInsertOrder;
  readonly recordCount: number;
};

export type RecordWriteCreateStreamPayload = {
  readonly recordsFieldValues: ReadonlyArray<RecordWriteFieldValues>;
  readonly batchSize: number;
  readonly recordCount: number;
};

export type RecordWriteDuplicatePayload = {
  readonly sourceRecordId: RecordId;
  readonly fieldValues: RecordWriteFieldValues;
  readonly order?: RecordInsertOrder;
  readonly recordCount: 1;
};

export type RecordWriteDuplicateStreamPayload = {
  readonly sourceRecordIds: ReadonlyArray<RecordId>;
  readonly recordsFieldValues: ReadonlyArray<RecordWriteFieldValues>;
  readonly batchSize: number;
  readonly order?: RecordInsertOrder;
  readonly recordCount: number;
};

export type RecordWriteUpdateOnePayload = {
  readonly recordId: RecordId;
  readonly fieldValues: RecordWriteFieldValues;
  readonly fieldKeyType: FieldKeyType;
  readonly typecast: boolean;
};

type RecordWriteUpdateManyPayloadBase = {
  readonly fieldKeyType: FieldKeyType;
  readonly typecast: boolean;
  readonly recordIds?: ReadonlyArray<RecordId>;
  readonly recordCount?: number;
};

export type RecordWriteUpdateManySelectorPayload = RecordWriteUpdateManyPayloadBase & {
  readonly variant: 'selector';
  readonly fieldValues: RecordWriteFieldValues;
};

export type RecordWriteUpdateManyExplicitPayload = RecordWriteUpdateManyPayloadBase & {
  readonly variant: 'explicit';
  readonly recordUpdates: ReadonlyArray<{
    readonly recordId: RecordId;
    readonly fieldValues: RecordWriteFieldValues;
  }>;
};

export type RecordWriteUpdateManyPayload =
  | RecordWriteUpdateManySelectorPayload
  | RecordWriteUpdateManyExplicitPayload;

export type RecordWriteDeleteManyPayload = {
  readonly recordIds: ReadonlyArray<RecordId>;
  readonly recordCount: number;
};

export type RecordWriteImportAppendPayload = {
  readonly sourceType: string;
  readonly sourceColumnMap: SourceColumnMap;
  readonly recordsFieldValues: ReadonlyArray<RecordWriteFieldValues>;
  readonly batchSize: number;
  readonly typecast: boolean;
  readonly recordCount: number;
  readonly maxRowCount?: number;
};

export type RecordWritePastePayload = {
  readonly editableFieldIds: ReadonlyArray<FieldId>;
  readonly updateRecordIds: ReadonlyArray<RecordId>;
  readonly updateRecordsFieldValues: ReadonlyArray<RecordWriteFieldValues>;
  readonly createRecordsFieldValues: ReadonlyArray<RecordWriteFieldValues>;
  readonly typecast: boolean;
  readonly updateRecordCount: number;
  readonly createRecordCount: number;
  readonly recordCount: number;
};

export type IRecordWriteCreateOneContext = IRecordWritePluginContextBase<
  'createOne',
  RecordWriteCreateOnePayload
>;
export type IRecordWriteCreateManyContext = IRecordWritePluginContextBase<
  'createMany',
  RecordWriteCreateManyPayload
>;
export type IRecordWriteCreateStreamContext = IRecordWritePluginContextBase<
  'createStream',
  RecordWriteCreateStreamPayload
>;
export type IRecordWriteSubmitContext = IRecordWritePluginContextBase<
  'submit',
  RecordWriteCreateOnePayload
>;
export type IRecordWriteDuplicateContext = IRecordWritePluginContextBase<
  'duplicate',
  RecordWriteDuplicatePayload
>;
export type IRecordWriteDuplicateStreamContext = IRecordWritePluginContextBase<
  'duplicateStream',
  RecordWriteDuplicateStreamPayload
>;
export type IRecordWriteUpdateOneContext = IRecordWritePluginContextBase<
  'updateOne',
  RecordWriteUpdateOnePayload
>;
export type IRecordWriteUpdateManyContext = IRecordWritePluginContextBase<
  'updateMany',
  RecordWriteUpdateManyPayload
>;
export type IRecordWriteDeleteManyContext = IRecordWritePluginContextBase<
  'deleteMany',
  RecordWriteDeleteManyPayload
>;
export type IRecordWriteImportAppendContext = IRecordWritePluginContextBase<
  'importAppend',
  RecordWriteImportAppendPayload
>;
export type IRecordWritePasteContext = IRecordWritePluginContextBase<
  'paste',
  RecordWritePastePayload
>;

export type RecordWritePluginContextMap = {
  createOne: IRecordWriteCreateOneContext;
  createMany: IRecordWriteCreateManyContext;
  createStream: IRecordWriteCreateStreamContext;
  submit: IRecordWriteSubmitContext;
  duplicate: IRecordWriteDuplicateContext;
  duplicateStream: IRecordWriteDuplicateStreamContext;
  updateOne: IRecordWriteUpdateOneContext;
  updateMany: IRecordWriteUpdateManyContext;
  deleteMany: IRecordWriteDeleteManyContext;
  importAppend: IRecordWriteImportAppendContext;
  paste: IRecordWritePasteContext;
};

export type RecordWritePluginContext = RecordWritePluginContextMap[RecordWriteOperationKind];

export type RecordWriteScopedFieldIdsResolver = (
  record: TableRecord
) => ReadonlySet<string> | undefined;

export interface RecordWritePluginScope {
  readonly recordSpec?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>;
  readonly updateFieldIds?: ReadonlySet<string>;
  readonly createFieldIds?: ReadonlySet<string>;
  readonly resolveUpdateFieldIdsForRecord?: RecordWriteScopedFieldIdsResolver;
}

export interface IRecordWritePlugin<TPreparedState = unknown> {
  readonly name: string;
  /**
   * Ordering hint applied when resolving matching plugins.
   * Hooks observe `pre -> default -> post` order.
   * `beforePersist` still runs serially in that resolved order because it executes inside
   * the transaction and must not fan out parallel work.
   */
  readonly enforce?: RecordWritePluginEnforce;

  supports(operation: RecordWriteOperationKind): boolean;

  prepare?(
    context: RecordWritePluginContext,
    previousPreparedState?: TPreparedState
  ): RecordWritePluginHookResult<TPreparedState>;

  scope?(
    context: RecordWritePluginContext,
    preparedState: TPreparedState | undefined
  ): RecordWritePluginHookResult<RecordWritePluginScope | undefined>;

  guard?(
    context: RecordWritePluginContext,
    preparedState: TPreparedState | undefined
  ): RecordWritePluginHookResult<void>;

  beforePersist?(
    context: RecordWritePluginContext,
    preparedState: TPreparedState | undefined
  ): RecordWritePluginHookResult<void>;

  afterCommit?(
    context: RecordWritePluginContext,
    preparedState: TPreparedState | undefined
  ): RecordWritePluginHookResult<void>;
}
