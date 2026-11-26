import { realpath, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ActorId,
  NoopSameTxProjectionDispatcher,
  v2CoreTokens,
  type DomainError,
  type IDomainWriteTransaction,
  type ICommandBus,
  type IQueryBus,
  type ISameTxProjectionDispatcher,
} from '@teable/v2-core';
import { err, ok, type Result } from 'neverthrow';

import { vcsDomainError } from '../domain/errors';
import type {
  IBaseVcsPatch,
  IBaseVcsSnapshot,
  IRecordVcsSnapshot,
  IVcsCloneRecordsChunk,
  IVcsEngineApplyResult,
  IVcsWorkingDelta,
} from '../domain/types';
import {
  V2EngineSyncAdapter,
  type IEngineExecutionOptions,
  type VcsRawSqlExecutor,
} from '../engine';
import type { IVcsHydrateRecordChunkResult, IVcsLocalEnginePort } from '../ports';

export interface IVcsPgliteRuntime {
  readonly commandBus: ICommandBus;
  readonly queryBus: IQueryBus;
  readonly queryRaw?: VcsRawSqlExecutor;
  ready(): Promise<void>;
  flushComputed(): Promise<unknown>;
  close(): Promise<void>;
}

export type VcsPgliteRuntimeFactory = (options: {
  readonly dataDir: string;
  readonly sameTxProjectionDispatcher: ISameTxProjectionDispatcher;
}) => Promise<IVcsPgliteRuntime>;

export interface IPgliteLocalEngineAdapterOptions {
  readonly dataDir?: string;
  readonly runtime?: IVcsPgliteRuntime;
  readonly createRuntime?: VcsPgliteRuntimeFactory;
  readonly actorId?: string;
}

export function applyPgliteVcsPatchAtomically(
  runtime: IVcsPgliteRuntime & { readonly container: { resolve<T>(token: symbol): T } },
  baseId: string,
  patch: IBaseVcsPatch
): Promise<Result<void, DomainError>> {
  const actor = ActorId.create(DEFAULT_ACTOR_ID);
  if (actor.isErr()) return Promise.resolve(err(actor.error));
  const transaction = runtime.container.resolve<IDomainWriteTransaction>(
    v2CoreTokens.domainWriteTransaction
  );
  const engine = new V2EngineSyncAdapter({
    commandBus: runtime.commandBus,
    queryBus: runtime.queryBus,
  });
  return transaction.withBatchTransaction(
    { actorId: actor.value },
    async (context) => {
      const result = await engine.applyPatch(baseId, patch, { context, skipCaptureSnapshot: true });
      return result.map(() => undefined);
    },
    { scope: 'data' }
  );
}

const DEFAULT_ACTOR_ID = 'usr_vcs_sync';

function resolveFilesystemDataDir(dataDir: string | undefined): string | undefined {
  if (!dataDir) {
    return undefined;
  }
  if (
    dataDir.startsWith('memory://') ||
    dataDir.startsWith('idb://') ||
    dataDir.startsWith('opfs-ahp://')
  ) {
    return undefined;
  }
  if (dataDir.startsWith('file://')) {
    return fileURLToPath(dataDir);
  }
  return resolve(dataDir);
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function mapPgliteThrownError(error: unknown, operation: string): DomainError {
  const code = getErrorCode(error);
  const message = getErrorMessage(error);
  if (code === 'pglite.data_dir_locked') {
    return vcsDomainError.conflict({
      code,
      message,
      details: { operation },
    });
  }
  return vcsDomainError.infrastructure({
    code: code ?? 'vcs.pglite_error',
    message: `PGlite ${operation} failed: ${message}`,
    details: { operation },
  });
}

async function hasPgVersionFile(fsDataDir: string): Promise<Result<boolean, DomainError>> {
  try {
    await stat(join(fsDataDir, 'PG_VERSION'));
    return ok(true);
  } catch (error) {
    const code = getErrorCode(error);
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return ok(false);
    }
    return err(
      vcsDomainError.infrastructure({
        code: 'vcs.pglite_stat_failed',
        message: `Failed to inspect PGlite directory ${fsDataDir}: ${getErrorMessage(error)}`,
        details: { fsDataDir },
      })
    );
  }
}

export class PgliteLocalEngineAdapter implements IVcsLocalEnginePort {
  private readonly dataDir?: string;
  private readonly runtime?: IVcsPgliteRuntime;
  private readonly createRuntime?: VcsPgliteRuntimeFactory;
  private readonly actorId: string;
  private activeSession?: {
    readonly runtime: IVcsPgliteRuntime;
    readonly adapter: V2EngineSyncAdapter;
    readonly ownsRuntime: boolean;
  };
  private sessionDepth = 0;

  constructor(options: IPgliteLocalEngineAdapterOptions) {
    this.dataDir = options.dataDir;
    this.runtime = options.runtime;
    this.createRuntime = options.createRuntime;
    this.actorId = options.actorId ?? DEFAULT_ACTOR_ID;
  }

  private createAdapterForRuntime(runtime: IVcsPgliteRuntime): V2EngineSyncAdapter {
    return new V2EngineSyncAdapter({
      commandBus: runtime.commandBus,
      queryBus: runtime.queryBus,
      actorId: this.actorId,
      flushComputed: () => runtime.flushComputed(),
      queryRaw: runtime.queryRaw
        ? (sqlText, params) => runtime.queryRaw!(sqlText, params)
        : undefined,
    });
  }

  async withSession<T>(
    fn: (engine: IVcsLocalEnginePort) => Promise<Result<T, DomainError>>
  ): Promise<Result<T, DomainError>> {
    if (this.activeSession) {
      this.sessionDepth += 1;
      try {
        return await fn(this);
      } catch (error) {
        return err(mapPgliteThrownError(error, 'withSession'));
      } finally {
        this.sessionDepth -= 1;
      }
    }

    let runtime = this.runtime;
    let ownsRuntime = false;

    try {
      if (!runtime) {
        if (!this.dataDir || !this.createRuntime) {
          return err(
            vcsDomainError.validation({
              code: 'vcs.pglite_config_invalid',
              message:
                'PgliteLocalEngineAdapter requires either runtime or both dataDir and createRuntime.',
            })
          );
        }
        runtime = await this.createRuntime({
          dataDir: this.dataDir,
          sameTxProjectionDispatcher: new NoopSameTxProjectionDispatcher(),
        });
        ownsRuntime = true;
      }

      const activeRuntime = runtime;
      await activeRuntime.ready();
      this.activeSession = {
        runtime: activeRuntime,
        adapter: this.createAdapterForRuntime(activeRuntime),
        ownsRuntime,
      };
      this.sessionDepth = 1;

      return await fn(this);
    } catch (error) {
      return err(mapPgliteThrownError(error, 'withSession'));
    } finally {
      this.sessionDepth = Math.max(0, this.sessionDepth - 1);
      if (this.sessionDepth === 0) {
        const session = this.activeSession;
        this.activeSession = undefined;
        if (session?.ownsRuntime) {
          await session.runtime.close().catch(() => undefined);
        } else if (!this.activeSession && ownsRuntime && runtime) {
          await runtime.close().catch(() => undefined);
        }
      }
    }
  }

  private async withAdapter<T>(
    operation: string,
    fn: (adapter: V2EngineSyncAdapter) => Promise<Result<T, DomainError>>
  ): Promise<Result<T, DomainError>> {
    if (this.activeSession) {
      try {
        return await fn(this.activeSession.adapter);
      } catch (error) {
        return err(mapPgliteThrownError(error, operation));
      }
    }

    return this.withSession(async () => {
      try {
        return await fn(this.activeSession!.adapter);
      } catch (error) {
        return err(mapPgliteThrownError(error, operation));
      }
    });
  }

  async hasBase(
    baseId: string,
    options?: IEngineExecutionOptions
  ): Promise<Result<boolean, DomainError>> {
    if (!this.runtime && !this.activeSession) {
      if (!this.dataDir || !this.createRuntime) {
        return err(
          vcsDomainError.validation({
            code: 'vcs.pglite_config_invalid',
            message:
              'PgliteLocalEngineAdapter requires either runtime or both dataDir and createRuntime.',
          })
        );
      }
      const fsDir = resolveFilesystemDataDir(this.dataDir);
      if (fsDir) {
        const versionCheck = await hasPgVersionFile(fsDir);
        if (versionCheck.isErr() || !versionCheck.value) {
          return versionCheck;
        }
      }
    }

    return this.withAdapter('hasBase', (adapter) => adapter.hasBase(baseId, options));
  }

  async captureSnapshot(
    baseId: string,
    options?: IEngineExecutionOptions
  ): Promise<Result<IBaseVcsSnapshot, DomainError>> {
    return this.withAdapter('captureSnapshot', (adapter) =>
      adapter.captureSnapshot(baseId, options)
    );
  }

  async hydrateSnapshot(
    snapshot: IBaseVcsSnapshot,
    options?: IEngineExecutionOptions
  ): Promise<Result<IVcsEngineApplyResult, DomainError>> {
    return this.withAdapter('hydrateSnapshot', (adapter) =>
      adapter.hydrateSnapshot(snapshot, options)
    );
  }

  async applyPatch(
    baseId: string,
    patch: IBaseVcsPatch,
    options?: IEngineExecutionOptions
  ): Promise<Result<IVcsEngineApplyResult, DomainError>> {
    return this.withAdapter('applyPatch', (adapter) => adapter.applyPatch(baseId, patch, options));
  }

  async hydrateRecordChunk(params: {
    readonly baseId: string;
    readonly tableId: string;
    readonly records: readonly IRecordVcsSnapshot[];
    readonly mode?: 'scalar-insert' | 'link-update';
  }): Promise<Result<IVcsHydrateRecordChunkResult, DomainError>> {
    return this.withAdapter('hydrateRecordChunk', (adapter) => adapter.hydrateRecordChunk(params));
  }

  async flushComputed(baseId: string): Promise<Result<number, DomainError>> {
    return this.withAdapter('flushComputed', (adapter) => adapter.flushComputed(baseId));
  }

  async captureTableRecordsChunk(
    baseId: string,
    tableId: string,
    options?: { readonly cursor?: string; readonly limit?: number }
  ): Promise<Result<IVcsCloneRecordsChunk, DomainError>> {
    return this.withAdapter('captureTableRecordsChunk', (adapter) =>
      adapter.captureTableRecordsChunk(baseId, tableId, options)
    );
  }

  async markWorkingClean(baseId: string): Promise<Result<void, DomainError>> {
    return this.withAdapter('markWorkingClean', (adapter) => adapter.markWorkingClean(baseId));
  }

  async ensureWorkingTrackingTriggers(baseId: string): Promise<Result<void, DomainError>> {
    return this.withAdapter('ensureWorkingTrackingTriggers', (adapter) =>
      adapter.ensureWorkingTrackingTriggers(baseId)
    );
  }

  async captureWorkingDelta(
    baseId: string,
    options?: IEngineExecutionOptions
  ): Promise<Result<IVcsWorkingDelta, DomainError>> {
    return this.withAdapter('captureWorkingDelta', (adapter) =>
      adapter.captureWorkingDelta(baseId, options)
    );
  }

  async reset(): Promise<Result<void, DomainError>> {
    const fsDir = resolveFilesystemDataDir(this.dataDir);
    if (!fsDir) {
      return ok(undefined);
    }

    try {
      const lockCandidates = new Set<string>([`${fsDir}.lock`]);
      const canonical = await realpath(fsDir).catch(() => undefined);
      if (canonical) {
        lockCandidates.add(`${canonical}.lock`);
      }

      for (const lockPath of lockCandidates) {
        await rm(lockPath, { recursive: true, force: true });
      }
      await rm(fsDir, { recursive: true, force: true });
      return ok(undefined);
    } catch (error) {
      return err(
        vcsDomainError.infrastructure({
          code: 'vcs.pglite_reset_failed',
          message: `Failed to reset PGlite directory ${fsDir}: ${getErrorMessage(error)}`,
          details: { fsDataDir: fsDir },
        })
      );
    }
  }
}
