/* eslint-disable sonarjs/no-duplicate-string */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Action } from '@teable/core';
import { HttpErrorCode } from '@teable/core';
import type { DataPrismaService } from '@teable/db-data-prisma';
import type { IRedoVo, IUndoRedoStreamEvent, IUndoVo } from '@teable/openapi';
import { domainError, TableId, toUndoRedoStackReplayContext, v2CoreTokens } from '@teable/v2-core';
import type {
  DomainError,
  UndoEntry,
  UndoRedoCommandData,
  UndoRedoReplayMode,
  UndoRedoReplayProgress,
  UndoRedoStackService as V2UndoRedoStackService,
} from '@teable/v2-core';
import { ClsService } from 'nestjs-cls';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { CacheService } from '../../../cache/cache.service';
import type { ICacheStore } from '../../../cache/types';
import { CustomHttpException } from '../../../custom.exception';
import { DataDbClientManager } from '../../../global/data-db-client-manager.service';
import type { IClsStore } from '../../../types/cls';
import { PermissionService } from '../../auth/permission.service';
import { RecordRemovalTombstoneService } from '../../record-removal-cold/record-removal-tombstone.service';
import { SpaceDataDbMigrationGuardService } from '../../space/space-data-db-migration-guard.service';
import { V2ContainerService } from '../../v2/v2-container.service';
import { V2ExecutionContextFactory } from '../../v2/v2-execution-context.factory';
import { UndoRedoOperationService } from '../stack/undo-redo-operation.service';
import { UndoRedoStackService } from '../stack/undo-redo-stack.service';
import {
  getV1UndoRedoRequiredActions,
  getV2UndoRedoRequiredActions,
  IUndoRedoPermissionResolver,
  UNDO_REDO_PERMISSION_RESOLVER,
} from '../undo-redo-permission';
import { buildUndoRedoEnginePreferenceKey } from './undo-redo-engine-preference';

export const X_TEABLE_UNDO_REDO_ENGINE_HEADER = 'x-teable-undo-redo-engine';

// Record ids a v2 undo restores back to the table: replaying RestoreRecords
// (undo of a delete) or RestoreArchivedRecords (undo of an archive) deletes the
// matching record_trash rows inside the engine, so these are the ids whose cold
// copies need suppression.
const collectV2RestoredRecordIds = (command: UndoRedoCommandData): string[] => {
  const leaves = command.type === 'Batch' ? command.payload : [command];
  const recordIds = new Set<string>();
  for (const leaf of leaves) {
    if (leaf.type === 'RestoreRecords' || leaf.type === 'RestoreArchivedRecords') {
      leaf.payload.records.forEach((record) => recordIds.add(record.recordId));
    }
  }
  return [...recordIds];
};

const describeV2Entry = (entry: UndoEntry, mode: UndoRedoReplayMode): string => {
  const command = mode === 'undo' ? entry.undoCommand : entry.redoCommand;
  const leaves = command.type === 'Batch' ? command.payload : [command];
  return leaves.map((leaf) => leaf.type).join('+');
};

const notAllowedOperationI18nKey = 'httpErrors.permission.notAllowedOperation';

export type IUndoRedoEngine = 'v1' | 'v2';

type IUndoRedoResponse<T extends IUndoVo | IRedoVo> = {
  body: T;
  engine: IUndoRedoEngine;
};

type IUndoRedoMode = 'undo' | 'redo';

type IV2Replay = {
  result: Result<UndoEntry | null, DomainError>;
  // The host exception raised by the permission gate, carried out of the
  // Result-only engine so the caller can rethrow it (403) instead of
  // reporting a `failed` replay.
  gateError?: unknown;
};

class UndoRedoStreamQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly resolvers: Array<(value: IteratorResult<T>) => void> = [];
  private closed = false;

  push(value: T) {
    if (this.closed) {
      return;
    }
    const resolver = this.resolvers.shift();
    if (resolver) {
      resolver({ value, done: false });
      return;
    }
    this.values.push(value);
  }

  close() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    while (this.resolvers.length) {
      this.resolvers.shift()?.({ value: undefined as T, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: async () => {
        const value = this.values.shift();
        if (value) {
          return { value, done: false };
        }
        if (this.closed) {
          return { value: undefined as T, done: true };
        }
        return await new Promise<IteratorResult<T>>((resolve) => {
          this.resolvers.push(resolve);
        });
      },
      return: async () => {
        this.close();
        return { value: undefined as T, done: true };
      },
    };
  }
}

@Injectable()
export class UndoRedoService {
  logger = new Logger(UndoRedoService.name);
  constructor(
    private readonly v2ContainerService: V2ContainerService,
    private readonly v2ContextFactory: V2ExecutionContextFactory,
    private readonly cls: ClsService<IClsStore>,
    private readonly cacheService: CacheService<ICacheStore>,
    private readonly undoRedoStackService: UndoRedoStackService,
    private readonly undoRedoOperationService: UndoRedoOperationService,
    private readonly dataDbClientManager: DataDbClientManager,
    private readonly recordRemovalTombstoneService: RecordRemovalTombstoneService,
    private readonly permissionService: PermissionService,
    @Optional()
    private readonly spaceDataDbMigrationGuard?: SpaceDataDbMigrationGuardService,
    // Enterprise-only: provided by the EE UndoRedoAuthorityModule (@Global).
    @Optional()
    @Inject(UNDO_REDO_PERMISSION_RESOLVER)
    private readonly permissionResolver?: IUndoRedoPermissionResolver
  ) {}

  // Cold-copy suppression after a fulfilled v2 undo. The row deletion happens
  // inside the v2 engine (package boundary — the tombstone service is out of
  // reach there), so the marker is written here once the replay committed.
  // Failure is logged, never rethrown: the undo itself succeeded, and failing
  // the response would invite a retry that pops ANOTHER stack entry.
  private async markV2RestoredTombstones(tableId: string, undoCommand: UndoRedoCommandData) {
    try {
      const recordIds = collectV2RestoredRecordIds(undoCommand);
      if (recordIds.length === 0) {
        return;
      }
      const dataPrisma = (await this.dataDbClientManager.dataPrismaForTable(tableId, {
        useTransaction: true,
      })) as DataPrismaService;
      await this.recordRemovalTombstoneService.markRestored(
        (dataPrisma.txClient?.() ?? dataPrisma) as DataPrismaService,
        tableId,
        recordIds
      );
    } catch (error) {
      this.logger.error(
        `tombstone marking failed after v2 undo on ${tableId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  async undo(tableId: string, windowId: string): Promise<IUndoRedoResponse<IUndoVo>> {
    await this.assertTableWritable(tableId);

    const preferredEngine = await this.getPreferredEngine(tableId, windowId);
    if (preferredEngine === 'v1') {
      const v1Result = await this.executeV1Undo(tableId, windowId);
      if (v1Result.body.status !== 'empty') {
        return v1Result;
      }

      const v2Result = await this.executeV2UndoRedo(tableId, windowId, 'undo');
      if (v2Result) {
        return v2Result;
      }

      return v1Result;
    }

    const v2Result = await this.executeV2UndoRedo(tableId, windowId, 'undo');
    if (v2Result) {
      return v2Result;
    }

    return this.executeV1Undo(tableId, windowId);
  }

  async redo(tableId: string, windowId: string): Promise<IUndoRedoResponse<IRedoVo>> {
    await this.assertTableWritable(tableId);

    const preferredEngine = await this.getPreferredEngine(tableId, windowId);
    if (preferredEngine === 'v1') {
      const v1Result = await this.executeV1Redo(tableId, windowId);
      if (v1Result.body.status !== 'empty') {
        return v1Result;
      }

      const v2Result = await this.executeV2UndoRedo(tableId, windowId, 'redo');
      if (v2Result) {
        return v2Result;
      }

      return v1Result;
    }

    const v2Result = await this.executeV2UndoRedo(tableId, windowId, 'redo');
    if (v2Result) {
      return v2Result;
    }

    return this.executeV1Redo(tableId, windowId);
  }

  async *undoStream(tableId: string, windowId: string): AsyncIterable<IUndoRedoStreamEvent> {
    await this.assertTableWritable(tableId);

    yield* this.executeUndoRedoStream(tableId, windowId, 'undo');
  }

  async *redoStream(tableId: string, windowId: string): AsyncIterable<IUndoRedoStreamEvent> {
    await this.assertTableWritable(tableId);

    yield* this.executeUndoRedoStream(tableId, windowId, 'redo');
  }

  private async assertTableWritable(tableId: string) {
    await this.spaceDataDbMigrationGuard?.assertTableWritable(tableId);
  }

  private async *executeUndoRedoStream(
    tableId: string,
    windowId: string,
    mode: IUndoRedoMode
  ): AsyncIterable<IUndoRedoStreamEvent> {
    const preferredEngine = await this.getPreferredEngine(tableId, windowId);

    if (preferredEngine === 'v1') {
      const v1Result =
        mode === 'undo'
          ? await this.executeV1Undo(tableId, windowId)
          : await this.executeV1Redo(tableId, windowId);
      if (v1Result.body.status !== 'empty') {
        yield this.toStreamTerminalEvent(mode, v1Result);
        return;
      }
      yield* this.executeV2UndoRedoStream(tableId, windowId, mode);
      return;
    }

    for await (const event of this.executeV2UndoRedoStream(tableId, windowId, mode)) {
      if (event.id === 'done' && event.status === 'empty') {
        const v1Result =
          mode === 'undo'
            ? await this.executeV1Undo(tableId, windowId)
            : await this.executeV1Redo(tableId, windowId);
        yield this.toStreamTerminalEvent(mode, v1Result);
        return;
      }
      yield event;
    }
  }

  private getPreferenceKey(
    tableId: string,
    windowId: string
  ): ReturnType<typeof buildUndoRedoEnginePreferenceKey> | null {
    const userId = this.cls.get('user.id');
    if (!userId || !windowId) {
      return null;
    }
    return buildUndoRedoEnginePreferenceKey(userId, tableId, windowId);
  }

  private async getPreferredEngine(
    tableId: string,
    windowId: string
  ): Promise<IUndoRedoEngine | undefined> {
    const key = this.getPreferenceKey(tableId, windowId);
    if (!key) {
      return undefined;
    }
    return this.cacheService.get(key);
  }

  private async executeV1Undo(
    tableId: string,
    windowId: string
  ): Promise<IUndoRedoResponse<IUndoVo>> {
    const { operation, push } = await this.undoRedoStackService.popUndo(tableId, windowId);

    if (!operation) {
      return {
        body: {
          status: 'empty',
        },
        engine: 'v1',
      };
    }

    // popUndo only rewrites the cached stacks inside `push`, so refusing here
    // leaves the entry in place — the same way a failed replay does below.
    await this.assertReplayPermitted(
      tableId,
      'undo',
      getV1UndoRedoRequiredActions(operation, 'undo'),
      operation.name
    );

    try {
      const newOperation = await this.undoRedoOperationService.undo(operation);
      await push(newOperation);
    } catch (error: unknown) {
      if (error instanceof Error) {
        this.logger.error(error.message, error.stack);
        return {
          body: {
            status: 'failed',
            errorMessage: error.message,
          },
          engine: 'v1',
        };
      }
      this.logger.error('An unknown error occurred');
      return {
        body: {
          status: 'failed',
          errorMessage: 'An unknown error occurred',
        },
        engine: 'v1',
      };
    }

    return {
      body: {
        status: 'fulfilled',
      },
      engine: 'v1',
    };
  }

  private async executeV1Redo(
    tableId: string,
    windowId: string
  ): Promise<IUndoRedoResponse<IRedoVo>> {
    const { operation, push } = await this.undoRedoStackService.popRedo(tableId, windowId);
    if (!operation) {
      return {
        body: {
          status: 'empty',
        },
        engine: 'v1',
      };
    }

    await this.assertReplayPermitted(
      tableId,
      'redo',
      getV1UndoRedoRequiredActions(operation, 'redo'),
      operation.name
    );

    try {
      const newOperation = await this.undoRedoOperationService.redo(operation);
      await push(newOperation);
    } catch (error: unknown) {
      if (error instanceof Error) {
        this.logger.error(error.message, error.stack);
        return {
          body: {
            status: 'failed',
            errorMessage: error.message,
          },
          engine: 'v1',
        };
      }
      this.logger.error('An unknown error occurred');
      return {
        body: {
          status: 'failed',
          errorMessage: 'An unknown error occurred',
        },
        engine: 'v1',
      };
    }

    return {
      body: {
        status: 'fulfilled',
      },
      engine: 'v1',
    };
  }

  private toV2FailedBody(error: { message: string; code?: string }): IUndoVo {
    return {
      status: 'failed',
      errorMessage: error.message,
      ...(error.code ? { errorCode: error.code } : {}),
    };
  }

  // Runs one v2 stack replay with the permission gate installed. The gate runs
  // inside the engine's reservation (`beforeReplay`), so the entry that gets
  // checked is exactly the one about to be replayed — group-composed and
  // race-free — and a veto aborts the reservation without consuming it.
  private async replayV2(
    tableId: string,
    windowId: string,
    mode: IUndoRedoMode,
    onProgress?: (progress: UndoRedoReplayProgress) => void
  ): Promise<IV2Replay> {
    const tableIdResult = TableId.create(tableId);
    if (tableIdResult.isErr()) {
      return { result: err(tableIdResult.error) };
    }

    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const stackService = container.resolve<V2UndoRedoStackService>(v2CoreTokens.undoRedoService);
    const context = await this.v2ContextFactory.createContext(container);
    context.windowId = windowId;

    let gateError: unknown;
    const beforeReplay = async (
      entry: UndoEntry,
      replayMode: UndoRedoReplayMode
    ): Promise<Result<void, DomainError>> => {
      try {
        await this.assertReplayPermitted(
          tableId,
          replayMode,
          getV2UndoRedoRequiredActions(entry, replayMode),
          describeV2Entry(entry, replayMode)
        );
        return ok(undefined);
      } catch (error: unknown) {
        // The engine is Result-only: a thrown error would skip its abort and
        // leave the reservation in flight until the lease expires.
        gateError = error;
        return err(
          error instanceof CustomHttpException
            ? domainError.forbidden({
                code: 'undo_redo.permission_denied',
                message: error.message,
              })
            : domainError.fromUnknown(error)
        );
      }
    };

    const replayContext = toUndoRedoStackReplayContext(context);
    const options = { onProgress, beforeReplay };
    const result =
      mode === 'undo'
        ? await stackService.applyUndo(replayContext, tableIdResult.value, windowId, options)
        : await stackService.applyRedo(replayContext, tableIdResult.value, windowId, options);
    return { result, gateError };
  }

  private async executeV2UndoRedo(
    tableId: string,
    windowId: string,
    mode: IUndoRedoMode
  ): Promise<IUndoRedoResponse<IUndoVo | IRedoVo> | undefined> {
    let replay: IV2Replay;
    try {
      replay = await this.replayV2(tableId, windowId, mode);
    } catch (error: unknown) {
      if (error instanceof Error) {
        this.logger.error(error.message, error.stack);
        return {
          body: {
            status: 'failed',
            errorMessage: error.message,
          },
          engine: 'v2',
        };
      }

      this.logger.error('An unknown error occurred');
      return {
        body: {
          status: 'failed',
          errorMessage: 'An unknown error occurred',
        },
        engine: 'v2',
      };
    }

    // A vetoed replay is a 403, not a `failed` replay: nothing was consumed.
    if (replay.gateError) {
      throw replay.gateError;
    }

    if (replay.result.isErr()) {
      return {
        body: this.toV2FailedBody(replay.result.error),
        engine: 'v2',
      };
    }

    if (!replay.result.value) {
      return undefined;
    }

    if (mode === 'undo') {
      await this.markV2RestoredTombstones(tableId, replay.result.value.undoCommand);
    }

    return {
      body: {
        status: 'fulfilled',
      },
      engine: 'v2',
    };
  }

  private executeV2UndoRedoStream(
    tableId: string,
    windowId: string,
    mode: IUndoRedoMode
  ): AsyncIterable<IUndoRedoStreamEvent> {
    const queue = new UndoRedoStreamQueue<IUndoRedoStreamEvent>();

    void (async () => {
      try {
        const { result: replayResult, gateError } = await this.replayV2(
          tableId,
          windowId,
          mode,
          (progress) =>
            queue.push({
              id: 'progress',
              mode,
              engine: 'v2',
              ...progress,
            })
        );
        if (gateError) {
          throw gateError;
        }

        if (replayResult.isErr()) {
          queue.push({
            id: 'error',
            mode,
            engine: 'v2',
            message: replayResult.error.message,
            code: replayResult.error.code,
          });
          return;
        }

        if (mode === 'undo' && replayResult.value) {
          await this.markV2RestoredTombstones(tableId, replayResult.value.undoCommand);
        }

        queue.push({
          id: 'done',
          mode,
          engine: 'v2',
          status: replayResult.value ? 'fulfilled' : 'empty',
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'An unknown error occurred';
        if (error instanceof Error) {
          this.logger.error(error.message, error.stack);
        } else {
          this.logger.error('An unknown error occurred');
        }
        queue.push({
          id: 'error',
          mode,
          engine: 'v2',
          message,
          // The stream already answered 200, so a refused replay travels as an
          // error event carrying the http error code instead of a 403.
          ...(error instanceof CustomHttpException ? { code: error.code } : {}),
        });
      } finally {
        queue.close();
      }
    })();

    return queue;
  }

  // Gate a replay by what it writes. Share-view, base-share and template
  // principals never resolve through a base role, so for them the permission
  // set the guard narrowed into cls is the only source of truth. Tables whose
  // writes an edition-specific model governs (enterprise authority matrix)
  // are checked against the set that model resolves — the route guard here
  // only saw the base role, which for matrix members is not what decides their
  // writes. Everybody else is re-resolved against their current base role and
  // token scope, exactly as the route guard would for a direct write.
  private async assertReplayPermitted(
    tableId: string,
    mode: IUndoRedoMode,
    actions: Action[] | null,
    entryDescription: string
  ) {
    if (!actions) {
      this.logger.warn(
        `${mode} on ${tableId} refused: no permission mapping for ${entryDescription}`
      );
      throw new CustomHttpException(
        `not allowed to ${mode} ${entryDescription} on ${tableId}`,
        HttpErrorCode.RESTRICTED_RESOURCE,
        { localization: { i18nKey: notAllowedOperationI18nKey } }
      );
    }
    if (!actions.length) {
      return;
    }

    if (this.isShareScopedRequest()) {
      this.assertActionsOwned(tableId, actions, this.cls.get('permissions') ?? []);
      return;
    }

    const resolved = await this.permissionResolver?.resolveTableActions(tableId);
    if (resolved) {
      this.assertActionsOwned(tableId, actions, resolved);
      return;
    }

    await this.permissionService.validPermissions(tableId, actions, this.cls.get('accessTokenId'));
  }

  private assertActionsOwned(tableId: string, actions: Action[], owned: Action[]) {
    const missing = actions.filter((action) => !owned.includes(action));
    if (missing.length) {
      throw new CustomHttpException(
        `not allowed to operate ${missing.join(', ')} on ${tableId}`,
        HttpErrorCode.RESTRICTED_RESOURCE,
        { localization: { i18nKey: notAllowedOperationI18nKey } }
      );
    }
  }

  private isShareScopedRequest() {
    return Boolean(
      this.cls.get('shareViewId') || this.cls.get('baseShare') || this.cls.get('template')
    );
  }

  private toStreamTerminalEvent(
    mode: IUndoRedoMode,
    response: IUndoRedoResponse<IUndoVo | IRedoVo>
  ): IUndoRedoStreamEvent {
    if (response.body.status === 'failed') {
      return {
        id: 'error',
        mode,
        engine: response.engine,
        message: response.body.errorMessage ?? 'Undo/redo failed',
      };
    }
    return {
      id: 'done',
      mode,
      engine: response.engine,
      status: response.body.status,
    };
  }
}
