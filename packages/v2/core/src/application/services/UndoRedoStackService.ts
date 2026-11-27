import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { ApplyFieldSnapshotCommand } from '../../commands/ApplyFieldSnapshotCommand';
import { ApplyRecordOrdersCommand } from '../../commands/ApplyRecordOrdersCommand';
import { ApplyViewSnapshotCommand } from '../../commands/ApplyViewSnapshotCommand';
import { ArchiveRecordsCommand } from '../../commands/ArchiveRecordsCommand';
import { DeleteFieldCommand } from '../../commands/DeleteFieldCommand';
import { DeleteRecordsCommand } from '../../commands/DeleteRecordsCommand';
import { DeleteViewCommand } from '../../commands/DeleteViewCommand';
import { DisableViewShareCommand } from '../../commands/DisableViewShareCommand';
import { EnableViewShareCommand } from '../../commands/EnableViewShareCommand';
import { ReplayFieldTypeConversionCommand } from '../../commands/ReplayFieldTypeConversionCommand';
import {
  RestoreRecordsCommand,
  type IDeferredSelfReferentialLinkRecord,
} from '../../commands/RestoreRecordsCommand';
import { SetButtonValueCommand } from '../../commands/SetButtonValueCommand';
import { UpdateRecordCommand } from '../../commands/UpdateRecordCommand';
import { UpdateRecordsCommand } from '../../commands/UpdateRecordsCommand';
import { domainError, type DomainError } from '../../domain/shared/DomainError';
import { RECORD_REMOVAL_REASON } from '../../domain/table/events/RecordsDeleted';
import { FieldKeyType } from '../../domain/table/fields/FieldKeyType';
import type { RecordId } from '../../domain/table/records/RecordId';
import { TableId } from '../../domain/table/TableId';
import * as CommandBusPort from '../../ports/CommandBus';
import type * as ExecutionContextPort from '../../ports/ExecutionContext';
import type { RecordStoredSnapshot, RecordUpdateSnapshot } from '../../ports/TableRecordRepository';
import { v2CoreTokens } from '../../ports/tokens';
import {
  createTeableSpanAttributes,
  TeableSpanAttributes,
  type ISpan,
  type SpanAttributes,
} from '../../ports/Tracer';
import { TraceSpan } from '../../ports/TraceSpan';
import {
  composeUndoRedoCommands,
  createUndoRedoCommand as buildUndoRedoCommand,
  isSupportedUndoRedoCommandVersion,
  type IUndoRedoStore,
  type UndoEntry,
  type UndoEntryInput,
  type UndoEntryGroupInput,
  type UndoRedoArchiveTrashRow,
  type UndoRedoCommandData,
  type UndoRedoCommandLeafData,
  type UndoRedoReplayMode,
  type UndoRedoSetButtonValueCommandData,
  type UndoRedoUpdateCommandData,
  type UndoRedoUpdateRecordsCommandData,
  type UndoScope,
  undoRedoCommandVersions,
} from '../../ports/UndoRedoStore';
import { toUndoRedoRestoreRecord } from './RecordMutationSnapshotContract';

export type RecordUpdateUndoRedoInput = {
  readonly tableId: TableId;
  readonly recordId: RecordId;
  readonly oldValues: Record<string, unknown>;
  readonly newValues: Record<string, unknown>;
  readonly recordVersionBefore: number;
  readonly recordVersionAfter: number;
  readonly undoCommandsAfter?: ReadonlyArray<UndoRedoCommandLeafData>;
  readonly redoCommandsBefore?: ReadonlyArray<UndoRedoCommandLeafData>;
};

export type RecordSnapshotUndoRedoInput = {
  readonly tableId: TableId;
  readonly recordId: RecordId;
  readonly snapshot: RecordUpdateSnapshot;
  /**
   * Field ids explicitly targeted by the original write command.
   * Storage-managed/system fields captured incidentally in the repository
   * snapshot should not be replayed through record undo.
   */
  readonly fieldIds: ReadonlyArray<string>;
  readonly undoCommandsAfter?: ReadonlyArray<UndoRedoCommandLeafData>;
  readonly redoCommandsBefore?: ReadonlyArray<UndoRedoCommandLeafData>;
};

export type ButtonValueSnapshotUndoRedoInput = {
  readonly tableId: TableId;
  readonly recordId: RecordId;
  readonly fieldId: string;
  readonly snapshot: RecordUpdateSnapshot;
};

export type RecordDeleteUndoRedoInput = {
  readonly tableId: TableId;
  readonly deletedRecords: ReadonlyArray<RecordStoredSnapshot>;
  readonly deletedRecordIds?: ReadonlyArray<string>;
  readonly undoCommandsAfter?: ReadonlyArray<UndoRedoCommandLeafData>;
  readonly redoCommandsBefore?: ReadonlyArray<UndoRedoCommandLeafData>;
} & UndoEntryGroupInput;

export type RecordArchiveUndoRedoInput = {
  readonly tableId: TableId;
  readonly archivedRecords: ReadonlyArray<RecordStoredSnapshot>;
  readonly recordIds: ReadonlyArray<string>;
  readonly archiveRows: ReadonlyArray<UndoRedoArchiveTrashRow>;
} & UndoEntryGroupInput;

export type RecordCreateUndoRedoInput = {
  readonly tableId: TableId;
  readonly createdRecords: ReadonlyArray<RecordStoredSnapshot>;
  readonly createdRecordIds?: ReadonlyArray<string>;
  readonly undoCommandsAfter?: ReadonlyArray<UndoRedoCommandLeafData>;
  readonly redoCommandsBefore?: ReadonlyArray<UndoRedoCommandLeafData>;
} & UndoEntryGroupInput;

export type UndoRedoStackEntryInput = Omit<
  UndoEntry,
  'scope' | 'createdAt' | 'requestId' | 'groupId'
> &
  UndoEntryGroupInput;

export type UndoRedoStackMode = NonNullable<
  ExecutionContextPort.IExecutionContext['undoRedo']
>['mode'];

type UndoRedoStackTracingContext = {
  readonly tracer?: ExecutionContextPort.IExecutionContext['tracer'];
};

type UndoRedoStackScopeContext = {
  readonly actorId: ExecutionContextPort.IExecutionContext['actorId'];
  readonly windowId?: string;
};

export type UndoRedoStackAppendContext = UndoRedoStackScopeContext &
  UndoRedoStackTracingContext & {
    readonly requestId?: string;
    readonly stackMode?: UndoRedoStackMode;
  };

export type UndoRedoStackReplayContext = UndoRedoStackScopeContext &
  UndoRedoStackTracingContext & {
    readonly requestId?: string;
    readonly initiator?: ExecutionContextPort.IExecutionContext['initiator'];
    readonly transaction?: ExecutionContextPort.IExecutionContext['transaction'];
    readonly config?: ExecutionContextPort.IExecutionContext['config'];
    readonly $t?: ExecutionContextPort.IExecutionContext['$t'];
  };

export type UndoRedoReplayProgress = {
  readonly phase: 'preparing' | 'replaying';
  readonly totalCount: number;
  readonly processedCount: number;
  readonly commandType?: UndoRedoCommandData['type'];
  readonly commandCount?: number;
};

export type UndoRedoReplayResult = {
  readonly entryCount: number;
};

export type UndoRedoReplayOptions = {
  readonly onProgress?: (progress: UndoRedoReplayProgress) => void;
  /**
   * Host veto over every selected entry, loaded one at a time before any
   * commands execute. A veto aborts without moving the cursor. Not called when
   * every command already succeeded and only the cursor commit remains.
   */
  readonly beforeReplay?: (
    entry: UndoEntry,
    mode: UndoRedoReplayMode
  ) => Promise<Result<void, DomainError>>;
  /** Best-effort notification, repeated for completed entries on cursor retries. */
  readonly onEntryReplayed?: (entry: UndoEntry, mode: UndoRedoReplayMode) => Promise<void>;
};

type UndoRedoReplayProgressState = {
  readonly totalCount: number;
  processedCount: number;
  readonly onProgress?: (progress: UndoRedoReplayProgress) => void;
  executedLeafIndex?: number;
  leafOffset?: number;
  skipAlreadyExecuted?: boolean;
  onLeafExecuted?: (index: number) => Promise<Result<void, DomainError>>;
  refreshViewInverse?: DeleteViewCommand['refreshInverse'];
  deferredSelfLinksByTableId?: Map<string, IDeferredSelfReferentialLinkRecord[]>;
  skippedSelfLinkCandidatesByTableId?: Map<string, IDeferredSelfReferentialLinkRecord[]>;
  tableSelfLinkFieldIds?: Map<string, ReadonlySet<string>>;
};

export const toUndoRedoStackAppendContext = (
  context: Pick<
    ExecutionContextPort.IExecutionContext,
    'actorId' | 'windowId' | 'requestId' | 'tracer' | 'undoRedo'
  >
): UndoRedoStackAppendContext => ({
  actorId: context.actorId,
  windowId: context.windowId,
  requestId: context.requestId,
  tracer: context.tracer,
  stackMode: context.undoRedo?.mode ?? 'normal',
});

export const toUndoRedoStackReplayContext = (
  context: Pick<
    ExecutionContextPort.IExecutionContext,
    'actorId' | 'initiator' | 'windowId' | 'requestId' | 'tracer' | 'transaction' | 'config' | '$t'
  >
): UndoRedoStackReplayContext => ({
  actorId: context.actorId,
  initiator: context.initiator,
  windowId: context.windowId,
  requestId: context.requestId,
  tracer: context.tracer,
  transaction: context.transaction,
  config: context.config,
  $t: context.$t,
});

const resolveUndoRedoStackMode = (context: UndoRedoStackAppendContext): UndoRedoStackMode =>
  context.stackMode ?? 'normal';

const isStoredLinkItemCandidate = (item: unknown): boolean =>
  typeof item === 'object' &&
  item !== null &&
  'id' in item &&
  typeof (item as { id?: unknown }).id === 'string' &&
  (item as { id: string }).id.startsWith('rec') &&
  !('path' in item);

const isStoredLinkFieldCandidateValue = (value: unknown): boolean => {
  if (Array.isArray(value)) {
    return value.length > 0 && value.every(isStoredLinkItemCandidate);
  }
  return isStoredLinkItemCandidate(value);
};

/**
 * Whether this append may reach the store. Callers build undo/redo payloads before appending,
 * so they must ask before constructing anything that only a recorded entry would consume.
 */
const shouldAppendUndoRedoEntry = (
  context: UndoRedoStackAppendContext
): context is UndoRedoStackAppendContext & { readonly windowId: string } =>
  resolveUndoRedoStackMode(context) === 'normal' && Boolean(context.windowId);

const describeError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message || error.name;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
};

/**
 * Maintains the per-window undo/redo interaction stack.
 *
 * Repository adapters own mutation snapshot capture. This service only consumes
 * those snapshots, translates them into stack entries, persists them into the
 * stack store, and replays stored commands back through the command bus.
 */
/**
 * Replay behavior knobs for undo/redo command reconstruction.
 *
 * restorePurgeGuard: when replaying a delete-undo as RestoreRecords, require a
 * surviving record_trash row (reason 'deleted') per record so a replay cannot
 * resurrect records the user purged from the recycle bin. The postgres adapter
 * writes id-only trash markers inside the delete transaction; the NestJS
 * projection later fills the recycle-bin JSON. Deployments without that
 * adapter method (memory repositories, some standalone containers) must keep
 * the guard off or every delete-undo silently restores nothing. Purging is
 * only possible where the sink exists, so the guard is exactly as available
 * as the risk it defends against. The archived variant is not gated: archive
 * snapshots are written inside the v2 delete transaction itself.
 */
export interface IUndoRedoReplayConfig {
  readonly restorePurgeGuard: boolean;
  readonly reservationRenewIntervalMs?: number;
}

export const defaultUndoRedoReplayConfig: IUndoRedoReplayConfig = {
  restorePurgeGuard: false,
  reservationRenewIntervalMs: 2_000,
};

@injectable()
export class UndoRedoStackService {
  constructor(
    @inject(v2CoreTokens.undoRedoStore)
    private readonly undoRedoStore: IUndoRedoStore,
    @inject(v2CoreTokens.commandBus)
    private readonly commandBus: CommandBusPort.ICommandBus,
    @inject(v2CoreTokens.undoRedoReplayConfig)
    private readonly replayConfig: IUndoRedoReplayConfig = defaultUndoRedoReplayConfig
  ) {}

  @TraceSpan({
    component: 'service',
    attributes: (_context, params: RecordUpdateUndoRedoInput) => ({
      [TeableSpanAttributes.TABLE_ID]: params.tableId.toString(),
      [TeableSpanAttributes.RECORD_ID]: params.recordId.toString(),
      'teable.undo_redo.mode': 'record_update',
      'teable.undo_redo.undo_commands_after_count': params.undoCommandsAfter?.length ?? 0,
      'teable.undo_redo.redo_commands_before_count': params.redoCommandsBefore?.length ?? 0,
    }),
  })
  async appendRecordUpdate(
    context: UndoRedoStackAppendContext,
    params: RecordUpdateUndoRedoInput
  ): Promise<Result<void, DomainError>> {
    if (Object.keys(params.oldValues).length === 0) {
      return ok(undefined);
    }

    const basePayload = {
      tableId: params.tableId.toString(),
      recordId: params.recordId.toString(),
      fieldKeyType: FieldKeyType.Id,
      typecast: false,
    } as const;

    const undoCommand: UndoRedoUpdateCommandData = {
      ...buildUndoRedoCommand('UpdateRecord', {
        ...basePayload,
        fields: params.oldValues,
      }),
    };

    const redoCommand: UndoRedoUpdateCommandData = {
      ...buildUndoRedoCommand('UpdateRecord', {
        ...basePayload,
        fields: params.newValues,
      }),
    };

    const entry: UndoRedoStackEntryInput = {
      undoCommand: composeUndoRedoCommands([undoCommand, ...(params.undoCommandsAfter ?? [])]),
      redoCommand: composeUndoRedoCommands([...(params.redoCommandsBefore ?? []), redoCommand]),
      recordVersionBefore: params.recordVersionBefore,
      recordVersionAfter: params.recordVersionAfter,
    };
    return this.appendEntry(context, params.tableId, entry);
  }

  @TraceSpan({
    component: 'service',
    attributes: (_context, params: RecordSnapshotUndoRedoInput) => ({
      [TeableSpanAttributes.TABLE_ID]: params.tableId.toString(),
      [TeableSpanAttributes.RECORD_ID]: params.recordId.toString(),
      'teable.undo_redo.mode': 'record_update_snapshot',
      'teable.undo_redo.field_count': params.fieldIds.length,
    }),
  })
  async appendRecordUpdateFromSnapshot(
    context: UndoRedoStackAppendContext,
    params: RecordSnapshotUndoRedoInput
  ): Promise<Result<void, DomainError>> {
    const oldValues: Record<string, unknown> = {};
    const newValues: Record<string, unknown> = {};

    for (const fieldId of params.fieldIds) {
      if (
        !(fieldId in params.snapshot.previous.fields) &&
        !(fieldId in params.snapshot.current.fields)
      ) {
        continue;
      }
      oldValues[fieldId] = params.snapshot.previous.fields[fieldId];
      newValues[fieldId] = params.snapshot.current.fields[fieldId];
    }

    return this.appendRecordUpdate(context, {
      tableId: params.tableId,
      recordId: params.recordId,
      oldValues,
      newValues,
      recordVersionBefore: params.snapshot.oldVersion,
      recordVersionAfter: params.snapshot.newVersion,
      undoCommandsAfter: params.undoCommandsAfter,
      redoCommandsBefore: params.redoCommandsBefore,
    });
  }

  @TraceSpan({
    component: 'service',
    attributes: (_context, params: ButtonValueSnapshotUndoRedoInput) => ({
      [TeableSpanAttributes.TABLE_ID]: params.tableId.toString(),
      [TeableSpanAttributes.RECORD_ID]: params.recordId.toString(),
      [TeableSpanAttributes.FIELD_ID]: params.fieldId,
      'teable.undo_redo.mode': 'button_value_update_snapshot',
    }),
  })
  async appendButtonValueUpdateFromSnapshot(
    context: UndoRedoStackAppendContext,
    params: ButtonValueSnapshotUndoRedoInput
  ): Promise<Result<void, DomainError>> {
    const normalizeValue = (
      value: unknown
    ): Result<{ readonly count: number } | null, DomainError> => {
      if (value == null) return ok(null);
      if (
        typeof value !== 'object' ||
        Array.isArray(value) ||
        typeof (value as { count?: unknown }).count !== 'number' ||
        !Number.isInteger((value as { count: number }).count) ||
        (value as { count: number }).count < 0
      ) {
        return err(
          domainError.validation({
            code: 'button.undo_value_invalid',
            message: `Invalid Button value captured for undo/redo: ${params.fieldId}`,
          })
        );
      }
      return ok({ count: (value as { count: number }).count });
    };

    const oldValue = normalizeValue(params.snapshot.previous.fields[params.fieldId]);
    if (oldValue.isErr()) return err(oldValue.error);
    const newValue = normalizeValue(params.snapshot.current.fields[params.fieldId]);
    if (newValue.isErr()) return err(newValue.error);

    const basePayload = {
      tableId: params.tableId.toString(),
      recordId: params.recordId.toString(),
      fieldId: params.fieldId,
    } as const;
    const undoCommand: UndoRedoSetButtonValueCommandData = buildUndoRedoCommand('SetButtonValue', {
      ...basePayload,
      value: oldValue.value,
    });
    const redoCommand: UndoRedoSetButtonValueCommandData = buildUndoRedoCommand('SetButtonValue', {
      ...basePayload,
      value: newValue.value,
    });
    return this.appendEntry(context, params.tableId, {
      undoCommand,
      redoCommand,
      recordVersionBefore: params.snapshot.oldVersion,
      recordVersionAfter: params.snapshot.newVersion,
    });
  }

  @TraceSpan({
    component: 'service',
    attributes: (_context, params: RecordDeleteUndoRedoInput) => ({
      [TeableSpanAttributes.TABLE_ID]: params.tableId.toString(),
      'teable.undo_redo.mode': 'record_delete',
      'teable.undo_redo.record_count': params.deletedRecords.length,
    }),
  })
  async appendRecordDelete(
    context: UndoRedoStackAppendContext,
    params: RecordDeleteUndoRedoInput
  ): Promise<Result<void, DomainError>> {
    if (!params.deletedRecords.length) {
      return ok(undefined);
    }
    const group: UndoEntryGroupInput =
      params.groupId !== undefined
        ? { groupId: params.groupId, groupPosition: params.groupPosition }
        : {};

    return this.appendEntry(context, params.tableId, {
      ...group,
      undoCommand: composeUndoRedoCommands([
        buildUndoRedoCommand('RestoreRecords', {
          tableId: params.tableId.toString(),
          records: params.deletedRecords.map((snapshot) => toUndoRedoRestoreRecord(snapshot)),
        }),
        ...(params.undoCommandsAfter ?? []),
      ]),
      redoCommand: composeUndoRedoCommands([
        ...(params.redoCommandsBefore ?? []),
        buildUndoRedoCommand('DeleteRecords', {
          tableId: params.tableId.toString(),
          recordIds:
            params.deletedRecordIds ?? params.deletedRecords.map((snapshot) => snapshot.recordId),
        }),
      ]),
    });
  }

  @TraceSpan({
    component: 'service',
    attributes: (_context, params: RecordArchiveUndoRedoInput) => ({
      [TeableSpanAttributes.TABLE_ID]: params.tableId.toString(),
      'teable.undo_redo.mode': 'record_archive',
      'teable.undo_redo.record_count': params.archivedRecords.length,
    }),
  })
  async appendRecordArchive(
    context: UndoRedoStackAppendContext,
    params: RecordArchiveUndoRedoInput
  ): Promise<Result<void, DomainError>> {
    if (!params.archivedRecords.length) {
      return ok(undefined);
    }
    const group: UndoEntryGroupInput =
      params.groupId !== undefined
        ? { groupId: params.groupId, groupPosition: params.groupPosition }
        : {};

    return this.appendEntry(context, params.tableId, {
      ...group,
      undoCommand: buildUndoRedoCommand('RestoreArchivedRecords', {
        tableId: params.tableId.toString(),
        records: params.archivedRecords.map((snapshot) => toUndoRedoRestoreRecord(snapshot)),
      }),
      redoCommand: buildUndoRedoCommand('ArchiveRecords', {
        tableId: params.tableId.toString(),
        recordIds: params.recordIds,
        archiveRows: params.archiveRows,
      }),
    });
  }

  @TraceSpan({
    component: 'service',
    attributes: (_context, params: RecordCreateUndoRedoInput) => ({
      [TeableSpanAttributes.TABLE_ID]: params.tableId.toString(),
      'teable.undo_redo.mode': 'record_create',
      'teable.undo_redo.record_count': params.createdRecords.length,
    }),
  })
  async appendRecordCreate(
    context: UndoRedoStackAppendContext,
    params: RecordCreateUndoRedoInput
  ): Promise<Result<void, DomainError>> {
    if (!params.createdRecords.length) {
      return ok(undefined);
    }

    // Restore payloads and the Delete/Restore commands are only consumed by a recorded entry.
    if (!shouldAppendUndoRedoEntry(context)) {
      return ok(undefined);
    }

    const createdRecordIds =
      params.createdRecordIds ?? params.createdRecords.map((snapshot) => snapshot.recordId);
    const group: UndoEntryGroupInput =
      params.groupId !== undefined
        ? { groupId: params.groupId, groupPosition: params.groupPosition }
        : {};

    return this.appendEntry(context, params.tableId, {
      ...group,
      undoCommand: composeUndoRedoCommands([
        buildUndoRedoCommand('DeleteRecords', {
          tableId: params.tableId.toString(),
          recordIds: createdRecordIds,
        }),
        ...(params.undoCommandsAfter ?? []),
      ]),
      redoCommand: composeUndoRedoCommands([
        ...(params.redoCommandsBefore ?? []),
        buildUndoRedoCommand('RestoreRecords', {
          tableId: params.tableId.toString(),
          records: params.createdRecords.map((snapshot) => toUndoRedoRestoreRecord(snapshot)),
        }),
      ]),
    });
  }

  @TraceSpan({
    component: 'service',
    attributes: (context, tableId: TableId) => ({
      [TeableSpanAttributes.TABLE_ID]: tableId.toString(),
      'teable.window_id': context.windowId ?? 'missing',
      'teable.undo_redo.mode': resolveUndoRedoStackMode(context),
    }),
  })
  async appendEntry(
    context: UndoRedoStackAppendContext,
    tableId: TableId,
    entry: UndoRedoStackEntryInput
  ): Promise<Result<void, DomainError>> {
    if (!shouldAppendUndoRedoEntry(context)) {
      return ok(undefined);
    }

    if (this.isEmptyCommand(entry.undoCommand) && this.isEmptyCommand(entry.redoCommand)) {
      return ok(undefined);
    }

    const scope: UndoScope = {
      actorId: context.actorId,
      tableId,
      windowId: context.windowId,
    };

    const entryWithScope: UndoEntryInput = {
      ...entry,
      scope,
      createdAt: new Date().toISOString(),
      requestId: context.requestId,
    };
    const appendResult = await this.runInSpan(
      context,
      'teable.UndoRedoStackService.storeAppend',
      createTeableSpanAttributes('service', 'UndoRedoStackService.storeAppend', {
        ...this.buildScopeTraceAttributes(scope),
        ...this.buildEntryTraceAttributes(entryWithScope),
      }),
      () => this.undoRedoStore.append(scope, entryWithScope)
    );
    if (appendResult.isErr()) {
      return err(appendResult.error);
    }
    return ok(undefined);
  }

  @TraceSpan({
    component: 'service',
    attributes: (context, tableId: TableId) => ({
      [TeableSpanAttributes.TABLE_ID]: tableId.toString(),
      'teable.window_id': context.windowId ?? 'missing',
      'teable.undo_redo.mode': 'undo',
    }),
  })
  async applyUndo(
    context: UndoRedoStackReplayContext,
    tableId: TableId,
    windowId?: string,
    options?: UndoRedoReplayOptions
  ): Promise<Result<UndoRedoReplayResult | null, DomainError>> {
    return this.applyStackEntry(context, tableId, windowId, 'undo', options);
  }

  @TraceSpan({
    component: 'service',
    attributes: (context, tableId: TableId) => ({
      [TeableSpanAttributes.TABLE_ID]: tableId.toString(),
      'teable.window_id': context.windowId ?? 'missing',
      'teable.undo_redo.mode': 'redo',
    }),
  })
  async applyRedo(
    context: UndoRedoStackReplayContext,
    tableId: TableId,
    windowId?: string,
    options?: UndoRedoReplayOptions
  ): Promise<Result<UndoRedoReplayResult | null, DomainError>> {
    return this.applyStackEntry(context, tableId, windowId, 'redo', options);
  }

  private async applyStackEntry(
    context: UndoRedoStackReplayContext,
    tableId: TableId,
    windowId: string | undefined,
    mode: 'undo' | 'redo',
    options?: UndoRedoReplayOptions
  ): Promise<Result<UndoRedoReplayResult | null, DomainError>> {
    const service = this; // NOSONAR typescript:S7740 -- generator functions cannot be arrow functions, so `this` must be captured
    return safeTry<UndoRedoReplayResult | null, DomainError>(async function* () {
      const scope = yield* service.resolveScope(context, tableId, windowId);
      const reserved = yield* await service.runInSpan(
        context,
        mode === 'undo'
          ? 'teable.UndoRedoStackService.storeUndo'
          : 'teable.UndoRedoStackService.storeRedo',
        createTeableSpanAttributes(
          'service',
          mode === 'undo' ? 'UndoRedoStackService.storeUndo' : 'UndoRedoStackService.storeRedo',
          {
            ...service.buildScopeTraceAttributes(scope),
            'teable.undo_redo.mode': mode,
          }
        ),
        () => service.undoRedoStore.reserve(scope, mode)
      );

      if (!reserved) return ok(null);

      let committed = false;
      try {
        return await service.withReservationHeartbeat<UndoRedoReplayResult>(
          scope,
          reserved.token,
          async (checkLease) =>
            safeTry<UndoRedoReplayResult, DomainError>(async function* () {
              yield* await service.undoRedoStore.renew(scope, reserved.token);
              if (reserved.executionStatus !== 'succeeded') {
                let totalCount = 0;
                let processedCount = 0;
                let preflightLeafOffset = 0;
                let restoreCommandCount = 0;
                // Preflight the entire group without retaining its payloads.
                for (let index = 0; index < reserved.entryCount; index += 1) {
                  yield* checkLease();
                  const entry = yield* await service.undoRedoStore.readReservedEntry(
                    scope,
                    reserved.token,
                    index
                  );
                  yield* service.validateReplayCommandData(entry.undoCommand);
                  yield* service.validateReplayCommandData(entry.redoCommand);
                  if (options?.beforeReplay) yield* await options.beforeReplay(entry, mode);
                  const command = mode === 'undo' ? entry.undoCommand : entry.redoCommand;
                  restoreCommandCount += service.countRestoreCommands(command);
                  const leafCount = command.type === 'Batch' ? command.payload.length : 1;
                  const unitCount = service.countReplayUnits(command);
                  totalCount += unitCount;
                  if (reserved.executedLeafIndex >= preflightLeafOffset + leafCount) {
                    processedCount += unitCount;
                  } else if (command.type === 'Batch') {
                    const completed = Math.max(0, reserved.executedLeafIndex - preflightLeafOffset);
                    for (let leaf = 0; leaf < completed; leaf += 1) {
                      processedCount += service.countReplayUnits(command.payload[leaf]!);
                    }
                  }
                  preflightLeafOffset += leafCount;
                }
                const progressState = service.createReplayProgressState(
                  totalCount,
                  processedCount,
                  options
                );
                if (restoreCommandCount > 1) {
                  progressState.deferredSelfLinksByTableId = new Map();
                  progressState.skippedSelfLinkCandidatesByTableId = new Map();
                  progressState.tableSelfLinkFieldIds = new Map();
                }
                progressState.executedLeafIndex = reserved.executedLeafIndex;
                progressState.onLeafExecuted = async (index) => {
                  const progressed = await service.undoRedoStore.markProgress(
                    scope,
                    reserved.token,
                    index
                  );
                  if (progressed.isErr()) return err(progressed.error);
                  return checkLease();
                };
                const executeContext = service.buildReplayExecutionContext(
                  context,
                  mode,
                  reserved.operationId
                );
                let leafOffset = 0;
                const deferredNotifyEntries: UndoEntry[] = [];
                for (let index = 0; index < reserved.entryCount; index += 1) {
                  yield* checkLease();
                  const entry = yield* await service.undoRedoStore.readReservedEntry(
                    scope,
                    reserved.token,
                    index
                  );
                  yield* checkLease();
                  const inverse = mode === 'undo' ? entry.redoCommand : entry.undoCommand;
                  // create, duplicate and delete each record one view command per entry.
                  progressState.refreshViewInverse = inverse.type === 'ApplyViewSnapshot'
                    ? (next) => service.undoRedoStore.replaceReservedInverse(scope, reserved.token, index, next)
                    : undefined;
                  const command = mode === 'undo' ? entry.undoCommand : entry.redoCommand;
                  const leafCount = command.type === 'Batch' ? command.payload.length : 1;
                  progressState.leafOffset = leafOffset;
                  progressState.skipAlreadyExecuted =
                    command.type !== 'Batch' && reserved.executedLeafIndex > leafOffset;
                  const deferredCountBefore = service.countDeferredSelfLinkRecords(progressState);
                  yield* await service.executeCommandData(executeContext, command, progressState);
                  leafOffset += leafCount;
                  if (command.type !== 'Batch' && !progressState.skipAlreadyExecuted) {
                    yield* await progressState.onLeafExecuted(leafOffset);
                  }
                  if (service.countDeferredSelfLinkRecords(progressState) > deferredCountBefore) {
                    deferredNotifyEntries.push(entry);
                  } else {
                    await service.notifyEntryReplayed(entry, mode, options);
                  }
                }
                const phase2TableIds = new Set<string>([
                  ...(progressState.deferredSelfLinksByTableId?.keys() ?? []),
                  ...(progressState.skippedSelfLinkCandidatesByTableId?.keys() ?? []),
                ]);
                if (phase2TableIds.size > 0) {
                  yield* checkLease();
                  for (const deferredTableId of phase2TableIds) {
                    const knownSelfLinkFields =
                      progressState.tableSelfLinkFieldIds?.get(deferredTableId);
                    if (knownSelfLinkFields && knownSelfLinkFields.size === 0) {
                      continue;
                    }
                    const byRecordId = new Map<string, IDeferredSelfReferentialLinkRecord>();
                    for (const skipped of progressState.skippedSelfLinkCandidatesByTableId?.get(
                      deferredTableId
                    ) ?? []) {
                      const filteredFields: Record<string, unknown> = {};
                      for (const [fieldId, value] of Object.entries(skipped.fields)) {
                        if (!knownSelfLinkFields || knownSelfLinkFields.has(fieldId)) {
                          filteredFields[fieldId] = value;
                        }
                      }
                      if (Object.keys(filteredFields).length > 0) {
                        byRecordId.set(skipped.recordId, {
                          recordId: skipped.recordId,
                          fields: filteredFields,
                          ...(skipped.cleanupTrash ? { cleanupTrash: true } : {}),
                        });
                      }
                    }
                    for (const deferred of progressState.deferredSelfLinksByTableId?.get(
                      deferredTableId
                    ) ?? []) {
                      const prev = byRecordId.get(deferred.recordId);
                      byRecordId.set(deferred.recordId, {
                        recordId: deferred.recordId,
                        fields: prev
                          ? { ...prev.fields, ...deferred.fields }
                          : { ...deferred.fields },
                        ...(prev?.cleanupTrash || deferred.cleanupTrash
                          ? { cleanupTrash: true }
                          : {}),
                      });
                    }
                    const deferredRecords = [...byRecordId.values()];
                    if (!deferredRecords.length) {
                      continue;
                    }
                    const cleanupTrashRecordIds = deferredRecords
                      .filter((entry) => entry.cleanupTrash)
                      .map((entry) => entry.recordId);
                    const linkCommand = RestoreRecordsCommand.create(
                      {
                        tableId: deferredTableId,
                        records: deferredRecords.map(({ recordId, fields }) => ({
                          recordId,
                          fields,
                        })),
                      },
                      {
                        selfReferentialLinksOnly: true,
                        ...(cleanupTrashRecordIds.length > 0 ? { cleanupTrashRecordIds } : {}),
                      }
                    );
                    if (linkCommand.isErr()) {
                      return err(linkCommand.error);
                    }
                    const linkResult = await service.commandBus.execute(
                      executeContext,
                      linkCommand.value
                    );
                    if (linkResult.isErr()) {
                      return err(linkResult.error);
                    }
                  }
                }
                for (const deferredEntry of deferredNotifyEntries) {
                  await service.notifyEntryReplayed(deferredEntry, mode, options);
                }
                yield* checkLease();
                yield* await service.undoRedoStore.renew(scope, reserved.token);
                yield* await service.undoRedoStore.markSucceeded(scope, reserved.token);
              } else {
                for (let index = 0; index < reserved.entryCount; index += 1) {
                  yield* checkLease();
                  const entry = yield* await service.undoRedoStore.readReservedEntry(
                    scope,
                    reserved.token,
                    index
                  );
                  await service.notifyEntryReplayed(entry, mode, options);
                }
              }
              let commitResult: Result<void, DomainError> | undefined;
              for (let attempt = 0; attempt < 3; attempt += 1) {
                yield* checkLease();
                commitResult = await service.undoRedoStore.commit(scope, reserved.token);
                if (commitResult.isOk()) {
                  committed = true;
                  return ok({ entryCount: reserved.entryCount });
                }
              }
              return err(
                commitResult?.isErr()
                  ? commitResult.error
                  : domainError.unexpected({ message: 'Undo/redo cursor commit failed' })
              );
            })
        );
      } catch (error) {
        return err(domainError.unexpected({ message: describeError(error) }));
      } finally {
        if (!committed) {
          try {
            await service.undoRedoStore.abort(scope, reserved.token);
          } catch {
            // Cleanup must not replace the original failure or persisted leaf progress.
          }
        }
      }
    });
  }

  private async notifyEntryReplayed(
    entry: UndoEntry,
    mode: UndoRedoReplayMode,
    options?: UndoRedoReplayOptions
  ): Promise<void> {
    try {
      await options?.onEntryReplayed?.(entry, mode);
    } catch {
      // Notifications cannot fail an already executed replay.
    }
  }

  private async withReservationHeartbeat<T>(
    scope: UndoScope,
    token: string,
    work: (checkLease: () => Result<void, DomainError>) => Promise<Result<T, DomainError>>
  ): Promise<Result<T, DomainError>> {
    const intervalMs = this.replayConfig.reservationRenewIntervalMs ?? 2_000;
    let heartbeatFailure: DomainError | undefined;
    const checkLease = (): Result<void, DomainError> =>
      heartbeatFailure ? err(heartbeatFailure) : ok(undefined);
    if (intervalMs <= 0) {
      return work(checkLease);
    }
    const timer = setInterval(() => {
      void this.undoRedoStore.renew(scope, token).then(
        (result) => {
          if (result.isErr()) heartbeatFailure = result.error;
        },
        (error: unknown) => {
          heartbeatFailure = domainError.unexpected({ message: describeError(error) });
        }
      );
    }, intervalMs);
    try {
      return await work(checkLease);
    } finally {
      clearInterval(timer);
    }
  }

  private createCommand(
    commandData: UndoRedoCommandData,
    progressState?: UndoRedoReplayProgressState
  ): Result<CommandBusPort.IPublicCommand, DomainError> {
    const versionResult = this.ensureSupportedCommandVersion(commandData);
    if (versionResult.isErr()) return err(versionResult.error);

    switch (commandData.type) {
      case 'UpdateRecord':
        return UpdateRecordCommand.create(commandData.payload);
      case 'SetButtonValue':
        return SetButtonValueCommand.create(commandData.payload);
      case 'UpdateRecords':
        return UpdateRecordsCommand.create(commandData.payload);
      case 'DeleteRecords':
        return DeleteRecordsCommand.create(commandData.payload);
      case 'RestoreRecords': {
        const deferSelfReferentialLinks = this.getDeferredSelfLinksCollector(
          progressState,
          commandData.payload.tableId
        );
        const onTableSelfLinkFieldsResolved = progressState?.tableSelfLinkFieldIds
          ? (selfLinkFieldIds: ReadonlySet<string>) => {
              progressState.tableSelfLinkFieldIds!.set(
                commandData.payload.tableId,
                selfLinkFieldIds
              );
            }
          : undefined;
        return RestoreRecordsCommand.create(commandData.payload, {
          ...(this.replayConfig.restorePurgeGuard
            ? { requireTrashRowReason: RECORD_REMOVAL_REASON.Deleted }
            : {}),
          trustedCreatedActorsByRecordId: this.trustedCreatedActors(commandData.payload.records),
          ...(deferSelfReferentialLinks ? { deferSelfReferentialLinks } : {}),
          ...(onTableSelfLinkFieldsResolved ? { onTableSelfLinkFieldsResolved } : {}),
        });
      }
      case 'RestoreArchivedRecords': {
        const deferSelfReferentialLinks = this.getDeferredSelfLinksCollector(
          progressState,
          commandData.payload.tableId
        );
        const onTableSelfLinkFieldsResolved = progressState?.tableSelfLinkFieldIds
          ? (selfLinkFieldIds: ReadonlySet<string>) => {
              progressState.tableSelfLinkFieldIds!.set(
                commandData.payload.tableId,
                selfLinkFieldIds
              );
            }
          : undefined;
        return RestoreRecordsCommand.create(commandData.payload, {
          cleanupAttachmentRefs: true,
          requireTrashRowReason: RECORD_REMOVAL_REASON.Archived,
          ...(deferSelfReferentialLinks ? { deferSelfReferentialLinks } : {}),
          ...(onTableSelfLinkFieldsResolved ? { onTableSelfLinkFieldsResolved } : {}),
          trustedCreatedActorsByRecordId: this.trustedCreatedActors(commandData.payload.records),
        });
      }
      case 'ArchiveRecords':
        return ArchiveRecordsCommand.create(
          { tableId: commandData.payload.tableId, recordIds: commandData.payload.recordIds },
          { archiveRows: commandData.payload.archiveRows }
        );
      case 'ApplyRecordOrders':
        return ApplyRecordOrdersCommand.create(commandData.payload);
      case 'DeleteField':
        return DeleteFieldCommand.create(commandData.payload);
      case 'ApplyFieldSnapshot':
        return ApplyFieldSnapshotCommand.create(commandData.payload);
      case 'ReplayFieldTypeConversion':
        return ReplayFieldTypeConversionCommand.create(commandData.payload);
      case 'ApplyViewSnapshot': {
        const { clearedLinkFilters, ...snapshotInput } = commandData.payload;
        return ApplyViewSnapshotCommand.create(snapshotInput, clearedLinkFilters);
      }
      case 'DeleteView':
        return DeleteViewCommand.create(commandData.payload, progressState?.refreshViewInverse);
      case 'EnableViewShare':
        return EnableViewShareCommand.create(commandData.payload);
      case 'DisableViewShare':
        return DisableViewShareCommand.create(commandData.payload);
      case 'Batch':
        return err(domainError.validation({ message: 'Batch undo/redo command must be expanded' }));
      default:
        return err(domainError.validation({ message: 'Unsupported undo/redo command type' }));
    }
  }

  private validateReplayCommandData(commandData: UndoRedoCommandData): Result<void, DomainError> {
    const versionResult = this.ensureSupportedCommandVersion(commandData);
    if (versionResult.isErr()) return err(versionResult.error);
    if (commandData.type === 'Batch') {
      for (const leaf of commandData.payload) {
        const result = this.createCommand(leaf);
        if (result.isErr()) return err(result.error);
      }
      return ok(undefined);
    }
    const result = this.createCommand(commandData);
    return result.isErr() ? err(result.error) : ok(undefined);
  }

  private async executeCommandData(
    context: ExecutionContextPort.IExecutionContext,
    commandData: UndoRedoCommandData,
    progressState?: UndoRedoReplayProgressState
  ): Promise<Result<void, DomainError>> {
    return this.runInSpan(
      context,
      'teable.UndoRedoStackService.executeCommandData',
      createTeableSpanAttributes('service', 'UndoRedoStackService.executeCommandData', {
        ...this.buildCommandTraceAttributes(commandData),
        'teable.undo_redo.mode': context.undoRedo?.mode ?? 'normal',
      }),
      async () => {
        if (commandData.type === 'Batch') {
          const versionResult = this.ensureSupportedCommandVersion(commandData);
          if (versionResult.isErr()) {
            return err(versionResult.error);
          }
          return this.executeBatchCommandData(context, commandData.payload, progressState);
        }

        if (progressState?.skipAlreadyExecuted) {
          this.collectSkippedRestoreSelfLinks(commandData, progressState);
          return ok(undefined);
        }

        const command = this.createCommand(commandData, progressState);
        if (command.isErr()) {
          return err(command.error);
        }

        const executeResult = await this.commandBus.execute(context, command.value);
        if (executeResult.isErr()) {
          return err(executeResult.error);
        }
        this.reportReplayProgress(commandData, progressState);
        return ok(undefined);
      }
    );
  }

  private async executeBatchCommandData(
    context: ExecutionContextPort.IExecutionContext,
    commands: ReadonlyArray<UndoRedoCommandLeafData>,
    progressState?: UndoRedoReplayProgressState
  ): Promise<Result<void, DomainError>> {
    let pendingUpdates: UndoRedoUpdateCommandData[] = [];
    const leafOffset = progressState?.leafOffset ?? 0;
    const startIndex = Math.max(0, (progressState?.executedLeafIndex ?? 0) - leafOffset);

    const markLeaf = async (index: number): Promise<Result<void, DomainError>> => {
      if (!progressState?.onLeafExecuted) {
        return ok(undefined);
      }
      return progressState.onLeafExecuted(leafOffset + index);
    };

    const flushPendingUpdates = async (nextIndex: number): Promise<Result<void, DomainError>> => {
      if (!pendingUpdates.length) {
        return ok(undefined);
      }
      const bulkCommand = this.buildUpdateRecordsCommand(pendingUpdates);
      pendingUpdates = [];
      const executeResult = await this.executeCommandData(context, bulkCommand, progressState);
      if (executeResult.isErr()) {
        return err(executeResult.error);
      }
      return markLeaf(nextIndex);
    };

    if (startIndex > 0 && progressState?.skippedSelfLinkCandidatesByTableId) {
      for (let i = 0; i < Math.min(startIndex, commands.length); i += 1) {
        this.collectSkippedRestoreSelfLinks(commands[i]!, progressState);
      }
    }

    for (let i = startIndex; i < commands.length; i += 1) {
      const nested = commands[i]!;
      if (nested.type === 'UpdateRecord') {
        if (
          pendingUpdates.length > 0 &&
          !this.canAppendToPendingUpdateRecords(pendingUpdates[0]!, nested)
        ) {
          const flushResult = await flushPendingUpdates(i);
          if (flushResult.isErr()) {
            return err(flushResult.error);
          }
        }
        pendingUpdates.push(nested);
        continue;
      }

      const flushResult = await flushPendingUpdates(i);
      if (flushResult.isErr()) {
        return err(flushResult.error);
      }

      const nestedResult = await this.executeCommandData(context, nested, progressState);
      if (nestedResult.isErr()) {
        return err(nestedResult.error);
      }
      const marked = await markLeaf(i + 1);
      if (marked.isErr()) {
        return err(marked.error);
      }
    }

    return flushPendingUpdates(commands.length);
  }

  private canAppendToPendingUpdateRecords(
    first: UndoRedoUpdateCommandData,
    next: UndoRedoUpdateCommandData
  ): boolean {
    return (
      first.payload.tableId === next.payload.tableId &&
      first.payload.fieldKeyType === next.payload.fieldKeyType &&
      first.payload.typecast === next.payload.typecast
    );
  }

  private buildUpdateRecordsCommand(
    updates: ReadonlyArray<UndoRedoUpdateCommandData>
  ): UndoRedoUpdateRecordsCommandData {
    const first = updates[0]!;
    return buildUndoRedoCommand('UpdateRecords', {
      tableId: first.payload.tableId,
      fieldKeyType: first.payload.fieldKeyType,
      typecast: first.payload.typecast,
      records: updates.map((update) => ({
        id: update.payload.recordId,
        fields: update.payload.fields,
      })),
    });
  }

  private isEmptyCommand(command: UndoRedoCommandData): boolean {
    if (command.type !== 'Batch') return false;
    return command.payload.length === 0;
  }

  private createReplayProgressState(
    totalCount: number,
    processedCount: number,
    options?: UndoRedoReplayOptions
  ): UndoRedoReplayProgressState {
    const state: UndoRedoReplayProgressState = {
      totalCount,
      processedCount,
      onProgress: options?.onProgress,
    };
    options?.onProgress?.({ phase: 'preparing', totalCount, processedCount });
    return state;
  }

  private reportReplayProgress(
    commandData: UndoRedoCommandData,
    progressState?: UndoRedoReplayProgressState
  ): void {
    if (!progressState?.onProgress) {
      return;
    }
    const commandCount = this.countReplayUnits(commandData);
    progressState.processedCount = Math.min(
      progressState.totalCount,
      progressState.processedCount + commandCount
    );
    progressState.onProgress({
      phase: 'replaying',
      totalCount: progressState.totalCount,
      processedCount: progressState.processedCount,
      commandType: commandData.type,
      commandCount,
    });
  }

  private countReplayUnits(commandData: UndoRedoCommandData): number {
    if (commandData.type === 'Batch') {
      return commandData.payload.reduce(
        (total, command) => total + this.countReplayUnits(command),
        0
      );
    }
    switch (commandData.type) {
      case 'UpdateRecords':
      case 'RestoreRecords':
      case 'RestoreArchivedRecords':
      case 'ApplyRecordOrders':
        return commandData.payload.records.length;
      case 'DeleteRecords':
      case 'ArchiveRecords':
        return commandData.payload.recordIds.length;
      default:
        return 1;
    }
  }

  private trustedCreatedActors(
    records: ReadonlyArray<{
      recordId: string;
      createdByActorType?:
        | NonNullable<ExecutionContextPort.IExecutionContext['initiator']>['type']
        | null;
      createdByActorId?: string | null;
    }>
  ) {
    return new Map(
      records.map(
        (record) =>
          [
            record.recordId,
            record.createdByActorType && record.createdByActorId
              ? { type: record.createdByActorType, id: record.createdByActorId }
              : null,
          ] as const
      )
    );
  }

  private buildReplayExecutionContext(
    context: UndoRedoStackReplayContext,
    mode: 'undo' | 'redo',
    operationId: string
  ): ExecutionContextPort.IExecutionContext {
    return {
      actorId: context.actorId,
      initiator: context.initiator,
      windowId: context.windowId,
      requestId: context.requestId,
      tracer: context.tracer,
      transaction: context.transaction,
      config: context.config,
      $t: context.$t,
      undoRedo: { mode, operationId },
    };
  }

  private resolveScope(
    context: UndoRedoStackScopeContext,
    tableId: TableId,
    windowId?: string
  ): Result<UndoScope, DomainError> {
    const resolvedWindowId = windowId ?? context.windowId;
    if (!resolvedWindowId) {
      return err(domainError.validation({ message: 'Missing windowId for undo/redo operation' }));
    }
    return ok({ actorId: context.actorId, tableId, windowId: resolvedWindowId });
  }

  private buildScopeTraceAttributes(scope: UndoScope): SpanAttributes {
    return {
      [TeableSpanAttributes.TABLE_ID]: scope.tableId.toString(),
      'teable.actor_id': scope.actorId.toString(),
      'teable.window_id': scope.windowId,
    };
  }

  private buildEntryTraceAttributes(
    entry: Pick<UndoEntry, 'undoCommand' | 'redoCommand'>
  ): SpanAttributes {
    return {
      'teable.undo_redo.undo_command_type': entry.undoCommand.type,
      'teable.undo_redo.undo_command_version': entry.undoCommand.version,
      'teable.undo_redo.redo_command_type': entry.redoCommand.type,
      'teable.undo_redo.redo_command_version': entry.redoCommand.version,
    };
  }

  private buildCommandTraceAttributes(commandData: UndoRedoCommandData): SpanAttributes {
    const attributes: Record<string, string | number | boolean> = {
      'teable.undo_redo.command_type': commandData.type,
      'teable.undo_redo.command_version': commandData.version,
    };

    if (
      commandData.type !== 'Batch' &&
      'tableId' in commandData.payload &&
      typeof commandData.payload.tableId === 'string'
    ) {
      attributes[TeableSpanAttributes.TABLE_ID] = commandData.payload.tableId;
    }

    if (commandData.type === 'UpdateRecord' || commandData.type === 'SetButtonValue') {
      attributes[TeableSpanAttributes.RECORD_ID] = commandData.payload.recordId;
    }

    if (commandData.type === 'SetButtonValue') {
      attributes[TeableSpanAttributes.FIELD_ID] = commandData.payload.fieldId;
    }

    if (commandData.type === 'UpdateRecords') {
      attributes['teable.undo_redo.record_count'] = commandData.payload.records.length;
    }

    if (commandData.type === 'DeleteField') {
      attributes[TeableSpanAttributes.FIELD_ID] = commandData.payload.fieldId;
    }

    if (
      commandData.type === 'ApplyFieldSnapshot' ||
      commandData.type === 'ReplayFieldTypeConversion'
    ) {
      attributes[TeableSpanAttributes.FIELD_ID] = commandData.payload.snapshot.field.id;
    }

    if (commandData.type === 'ApplyViewSnapshot') {
      attributes['teable.view_id'] = commandData.payload.snapshot.id;
    }

    if (
      commandData.type === 'DeleteView' ||
      commandData.type === 'EnableViewShare' ||
      commandData.type === 'DisableViewShare'
    ) {
      attributes['teable.view_id'] = commandData.payload.viewId;
    }

    if (commandData.type === 'Batch') {
      attributes['teable.undo_redo.batch_size'] = commandData.payload.length;
    }

    return attributes;
  }

  private countRestoreCommands(commandData: UndoRedoCommandData): number {
    if (commandData.type === 'RestoreRecords' || commandData.type === 'RestoreArchivedRecords') {
      return 1;
    }
    if (commandData.type === 'Batch') {
      let count = 0;
      for (const leaf of commandData.payload) {
        if (leaf.type === 'RestoreRecords' || leaf.type === 'RestoreArchivedRecords') {
          count += 1;
        }
      }
      return count;
    }
    return 0;
  }

  private getDeferredSelfLinksCollector(
    progressState: UndoRedoReplayProgressState | undefined,
    tableId: string
  ): IDeferredSelfReferentialLinkRecord[] | undefined {
    const map = progressState?.deferredSelfLinksByTableId;
    if (!map) {
      return undefined;
    }
    let collector = map.get(tableId);
    if (!collector) {
      collector = [];
      map.set(tableId, collector);
    }
    return collector;
  }

  private getSkippedSelfLinkCandidatesCollector(
    progressState: UndoRedoReplayProgressState | undefined,
    tableId: string
  ): IDeferredSelfReferentialLinkRecord[] | undefined {
    const map = progressState?.skippedSelfLinkCandidatesByTableId;
    if (!map) {
      return undefined;
    }
    let collector = map.get(tableId);
    if (!collector) {
      collector = [];
      map.set(tableId, collector);
    }
    return collector;
  }

  private countDeferredSelfLinkRecords(
    progressState: UndoRedoReplayProgressState | undefined
  ): number {
    let count = 0;
    if (progressState?.deferredSelfLinksByTableId) {
      for (const records of progressState.deferredSelfLinksByTableId.values()) {
        count += records.length;
      }
    }
    if (progressState?.skippedSelfLinkCandidatesByTableId) {
      for (const records of progressState.skippedSelfLinkCandidatesByTableId.values()) {
        count += records.length;
      }
    }
    return count;
  }

  private collectSkippedRestoreSelfLinks(
    commandData: UndoRedoCommandData,
    progressState: UndoRedoReplayProgressState | undefined
  ): void {
    if (!progressState?.skippedSelfLinkCandidatesByTableId) {
      return;
    }
    if (commandData.type === 'RestoreRecords' || commandData.type === 'RestoreArchivedRecords') {
      const knownSelfLinkFields = progressState.tableSelfLinkFieldIds?.get(
        commandData.payload.tableId
      );
      if (knownSelfLinkFields && knownSelfLinkFields.size === 0) {
        return;
      }
      const collector = this.getSkippedSelfLinkCandidatesCollector(
        progressState,
        commandData.payload.tableId
      );
      if (!collector) {
        return;
      }
      for (const record of commandData.payload.records) {
        if (!record.fields) {
          continue;
        }
        const linkFields: Record<string, unknown> = {};
        for (const [fieldId, value] of Object.entries(record.fields)) {
          if (knownSelfLinkFields && !knownSelfLinkFields.has(fieldId)) {
            continue;
          }
          if (isStoredLinkFieldCandidateValue(value)) {
            linkFields[fieldId] = value;
          }
        }
        if (Object.keys(linkFields).length > 0) {
          collector.push({
            recordId: record.recordId,
            fields: linkFields,
            cleanupTrash: true,
          });
        }
      }
      return;
    }
    if (commandData.type === 'Batch') {
      for (const leaf of commandData.payload) {
        this.collectSkippedRestoreSelfLinks(leaf, progressState);
      }
    }
  }

  private async runInSpan<T>(
    context: UndoRedoStackTracingContext,
    name: `teable.${string}`,
    attributes: SpanAttributes,
    callback: () => Promise<Result<T, DomainError>>
  ): Promise<Result<T, DomainError>> {
    const tracer = context.tracer;
    let span: ISpan | undefined;
    if (tracer) {
      try {
        span = tracer.startSpan(name, attributes);
      } catch {
        span = undefined;
      }
    }

    const execute = async () => {
      const result = await callback();
      if (result.isErr()) {
        span?.recordError(result.error.message);
      }
      return result;
    };

    try {
      return tracer && span ? await tracer.withSpan(span, execute) : await execute();
    } catch (error) {
      const message = describeError(error) || 'Undo/redo tracing callback failed';
      span?.recordError(message);
      return err(domainError.unexpected({ message }));
    } finally {
      span?.end();
    }
  }

  private ensureSupportedCommandVersion(
    commandData: UndoRedoCommandData
  ): Result<void, DomainError> {
    if (isSupportedUndoRedoCommandVersion(commandData)) {
      return ok(undefined);
    }

    return err(
      domainError.validation({
        message: `Unsupported undo/redo command version for ${commandData?.type}: ${commandData?.version}, expected ${undoRedoCommandVersions[commandData?.type]}`,
        localization: { i18nKey: 'httpErrors.undoRedo.unsupportedCommandVersion' },
      })
    );
  }
}
