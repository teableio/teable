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
import { RestoreRecordsCommand } from '../../commands/RestoreRecordsCommand';
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
  type UndoRedoArchiveTrashRow,
  type UndoRedoCommandData,
  type UndoRedoCommandLeafData,
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
  readonly groupId?: string;
  readonly undoCommandsAfter?: ReadonlyArray<UndoRedoCommandLeafData>;
  readonly redoCommandsBefore?: ReadonlyArray<UndoRedoCommandLeafData>;
};

export type RecordArchiveUndoRedoInput = {
  readonly tableId: TableId;
  readonly archivedRecords: ReadonlyArray<RecordStoredSnapshot>;
  readonly recordIds: ReadonlyArray<string>;
  readonly archiveRows: ReadonlyArray<UndoRedoArchiveTrashRow>;
  readonly groupId?: string;
};

export type RecordCreateUndoRedoInput = {
  readonly tableId: TableId;
  readonly createdRecords: ReadonlyArray<RecordStoredSnapshot>;
  readonly createdRecordIds?: ReadonlyArray<string>;
  readonly groupId?: string;
  readonly undoCommandsAfter?: ReadonlyArray<UndoRedoCommandLeafData>;
  readonly redoCommandsBefore?: ReadonlyArray<UndoRedoCommandLeafData>;
};

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

export type UndoRedoReplayOptions = {
  readonly onProgress?: (progress: UndoRedoReplayProgress) => void;
};

type UndoRedoReplayProgressState = {
  readonly totalCount: number;
  processedCount: number;
  readonly onProgress?: (progress: UndoRedoReplayProgress) => void;
  executedLeafIndex?: number;
  skipAlreadyExecuted?: boolean;
  onLeafExecuted?: (index: number) => Promise<Result<void, DomainError>>;
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
    'actorId' | 'windowId' | 'requestId' | 'tracer' | 'transaction' | 'config' | '$t'
  >
): UndoRedoStackReplayContext => ({
  actorId: context.actorId,
  windowId: context.windowId,
  requestId: context.requestId,
  tracer: context.tracer,
  transaction: context.transaction,
  config: context.config,
  $t: context.$t,
});

const resolveUndoRedoStackMode = (context: UndoRedoStackAppendContext): UndoRedoStackMode =>
  context.stackMode ?? 'normal';

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

    const entry: Omit<UndoEntry, 'scope' | 'createdAt' | 'requestId'> = {
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

    return this.appendEntry(context, params.tableId, {
      ...(params.groupId ? { groupId: params.groupId } : {}),
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

    return this.appendEntry(context, params.tableId, {
      ...(params.groupId ? { groupId: params.groupId } : {}),
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

    const createdRecordIds =
      params.createdRecordIds ?? params.createdRecords.map((snapshot) => snapshot.recordId);

    return this.appendEntry(context, params.tableId, {
      ...(params.groupId ? { groupId: params.groupId } : {}),
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
    entry: Omit<UndoEntry, 'scope' | 'createdAt' | 'requestId'>
  ): Promise<Result<void, DomainError>> {
    if (context.stackMode === 'undo' || context.stackMode === 'redo') {
      return ok(undefined);
    }

    if (!context.windowId) {
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

    const entryWithScope: UndoEntry = {
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
  ): Promise<Result<UndoEntry | null, DomainError>> {
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
  ): Promise<Result<UndoEntry | null, DomainError>> {
    return this.applyStackEntry(context, tableId, windowId, 'redo', options);
  }

  private async applyStackEntry(
    context: UndoRedoStackReplayContext,
    tableId: TableId,
    windowId: string | undefined,
    mode: 'undo' | 'redo',
    options?: UndoRedoReplayOptions
  ): Promise<Result<UndoEntry | null, DomainError>> {
    const service = this;
    return safeTry<UndoEntry | null, DomainError>(async function* () {
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

      const commandData = mode === 'undo' ? reserved.entry.undoCommand : reserved.entry.redoCommand;

      if (reserved.executionStatus !== 'succeeded') {
        yield* await service.undoRedoStore.renew(scope, reserved.token);
        const executeContext = service.buildReplayExecutionContext(
          context,
          mode,
          reserved.operationId
        );
        const progressState: UndoRedoReplayProgressState = service.createReplayProgressState(
          commandData,
          options
        ) ?? {
          totalCount: 0,
          processedCount: 0,
        };
        progressState.executedLeafIndex = reserved.executedLeafIndex;
        progressState.skipAlreadyExecuted =
          commandData.type !== 'Batch' && reserved.executedLeafIndex >= 1;
        progressState.onLeafExecuted = async (index) => {
          await service.undoRedoStore.renew(scope, reserved.token);
          return service.undoRedoStore.markProgress(scope, reserved.token, index);
        };

        const executeResult = await service.withReservationHeartbeat(scope, reserved.token, () =>
          service.executeCommandData(executeContext, commandData, progressState)
        );
        if (executeResult.isErr()) {
          await service.undoRedoStore.abort(scope, reserved.token);
          return err(executeResult.error);
        }
        if (commandData.type !== 'Batch') {
          const progressed = await service.undoRedoStore.markProgress(scope, reserved.token, 1);
          if (progressed.isErr()) {
            await service.undoRedoStore.abort(scope, reserved.token);
            return err(progressed.error);
          }
        }

        await service.undoRedoStore.renew(scope, reserved.token);
        const succeeded = await service.undoRedoStore.markSucceeded(scope, reserved.token);
        if (succeeded.isErr()) {
          await service.undoRedoStore.abort(scope, reserved.token);
          return err(succeeded.error);
        }
      }

      const maxCommitAttempts = 3;
      let commitResult: Result<void, DomainError> | undefined;
      for (let attempt = 0; attempt < maxCommitAttempts; attempt += 1) {
        commitResult = await service.undoRedoStore.commit(scope, reserved.token);
        if (commitResult.isOk()) {
          break;
        }
      }
      if (!commitResult || commitResult.isErr()) {
        return err(
          commitResult?.error ??
            domainError.unexpected({ message: 'Undo/redo cursor commit failed' })
        );
      }

      return ok(reserved.entry);
    });
  }

  private async withReservationHeartbeat<T>(
    scope: UndoScope,
    token: string,
    work: () => Promise<T>
  ): Promise<T> {
    const intervalMs = this.replayConfig.reservationRenewIntervalMs ?? 2_000;
    if (intervalMs <= 0) {
      return work();
    }
    const timer = setInterval(() => {
      void this.undoRedoStore.renew(scope, token);
    }, intervalMs);
    try {
      return await work();
    } finally {
      clearInterval(timer);
    }
  }

  private createCommand(
    commandData: UndoRedoCommandData
  ): Result<CommandBusPort.IPublicCommand, DomainError> {
    const versionResult = this.ensureSupportedCommandVersion(commandData);
    if (versionResult.isErr()) {
      return err(versionResult.error);
    }

    switch (commandData.type) {
      case 'UpdateRecord': {
        return UpdateRecordCommand.create(commandData.payload);
      }
      case 'SetButtonValue': {
        return SetButtonValueCommand.create(commandData.payload);
      }
      case 'UpdateRecords': {
        return UpdateRecordsCommand.create(commandData.payload);
      }
      case 'DeleteRecords': {
        return DeleteRecordsCommand.create(commandData.payload);
      }
      case 'RestoreRecords': {
        // requireTrashRowReason: the entry embeds full snapshots; a replay after the
        // user emptied the recycle bin must not resurrect the purged records. Only
        // deployments whose delete path writes trash markers enable this — see
        // IUndoRedoReplayConfig.restorePurgeGuard.
        return RestoreRecordsCommand.create(
          commandData.payload,
          this.replayConfig.restorePurgeGuard
            ? { requireTrashRowReason: RECORD_REMOVAL_REASON.Deleted }
            : {}
        );
      }
      case 'RestoreArchivedRecords': {
        // The kept attachment reference rows must go before the insert rebuilds them,
        // and the restore's trash cleanup removes the archive snapshot rows.
        // requireTrashRowReason: same purge guard as RestoreRecords, against the
        // archived snapshot rows (permanently deleted archive items stay deleted).
        return RestoreRecordsCommand.create(commandData.payload, {
          cleanupAttachmentRefs: true,
          requireTrashRowReason: RECORD_REMOVAL_REASON.Archived,
        });
      }
      case 'ArchiveRecords': {
        // Redo carries the rows the undo removed so the handler re-persists them
        // instead of rebuilding snapshots from the current row values.
        return ArchiveRecordsCommand.create(
          { tableId: commandData.payload.tableId, recordIds: commandData.payload.recordIds },
          { archiveRows: commandData.payload.archiveRows }
        );
      }
      case 'ApplyRecordOrders': {
        return ApplyRecordOrdersCommand.create(commandData.payload);
      }
      case 'DeleteField': {
        return DeleteFieldCommand.create(commandData.payload);
      }
      case 'ApplyFieldSnapshot': {
        return ApplyFieldSnapshotCommand.create(commandData.payload);
      }
      case 'ReplayFieldTypeConversion': {
        return ReplayFieldTypeConversionCommand.create(commandData.payload);
      }
      case 'ApplyViewSnapshot': {
        return ApplyViewSnapshotCommand.create(commandData.payload);
      }
      case 'DeleteView': {
        return DeleteViewCommand.create(commandData.payload);
      }
      case 'EnableViewShare': {
        return EnableViewShareCommand.create(commandData.payload);
      }
      case 'DisableViewShare': {
        return DisableViewShareCommand.create(commandData.payload);
      }
      case 'Batch': {
        return err(domainError.validation({ message: 'Batch undo/redo command must be expanded' }));
      }
      default:
        return err(
          domainError.validation({
            message: 'Unsupported undo/redo command type',
          })
        );
    }
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
          return ok(undefined);
        }

        const command = this.createCommand(commandData);
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
    const startIndex = progressState?.executedLeafIndex ?? 0;

    const markLeaf = async (index: number): Promise<Result<void, DomainError>> => {
      if (!progressState?.onLeafExecuted) {
        return ok(undefined);
      }
      return progressState.onLeafExecuted(index);
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
    commandData: UndoRedoCommandData,
    options?: UndoRedoReplayOptions
  ): UndoRedoReplayProgressState | undefined {
    if (!options?.onProgress) {
      return undefined;
    }
    const state: UndoRedoReplayProgressState = {
      totalCount: this.countReplayUnits(commandData),
      processedCount: 0,
      onProgress: options.onProgress,
    };
    options.onProgress({
      phase: 'preparing',
      totalCount: state.totalCount,
      processedCount: 0,
    });
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
    switch (commandData.type) {
      case 'Batch':
        return commandData.payload.reduce(
          (total, command) => total + this.countReplayUnits(command),
          0
        );
      case 'UpdateRecords':
        return commandData.payload.records.length;
      case 'DeleteRecords':
        return commandData.payload.recordIds.length;
      case 'RestoreRecords':
        return commandData.payload.records.length;
      case 'ArchiveRecords':
        return commandData.payload.recordIds.length;
      case 'RestoreArchivedRecords':
        return commandData.payload.records.length;
      case 'ApplyRecordOrders':
        return commandData.payload.records.length;
      default:
        return 1;
    }
  }

  private buildReplayExecutionContext(
    context: UndoRedoStackReplayContext,
    mode: 'undo' | 'redo',
    operationId: string
  ): ExecutionContextPort.IExecutionContext {
    return {
      actorId: context.actorId,
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
        message: `Unsupported undo/redo command version for ${commandData.type}: ${commandData.version}, expected ${undoRedoCommandVersions[commandData.type]}`,
      })
    );
  }
}
