import type { DomainError } from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { diffSnapshots, isEmptyPatch, summarizePatch } from '../../domain/diffSnapshots';
import { readonlyCheckoutError, vcsDomainError } from '../../domain/errors';
import { canonicalizeSnapshot } from '../../domain/fieldClassification';
import type {
  IBaseVcsPatchSummary,
  IBaseVcsSnapshot,
  IRecordVcsSnapshot,
  ITableVcsSnapshot,
  VcsMultiValueStrategy,
  VcsRemoteMode,
} from '../../domain/types';
import {
  v2VcsClientTokens,
  type IVcsLocalEnginePort,
  type IVcsRemoteGateway,
  type IVcsStateRepository,
  type IVcsWorkspaceConfig,
} from '../../ports';
import { alignSourceSnapshot } from './DiffBaseVcsService';
import { historicalEngineSnapshot } from './historicalEngineSnapshot';
import {
  EAGER_RETURN_SNAPSHOT_RECORD_LIMIT,
  loadVcsWorkspace,
  runWithEngineSession,
} from './workspaceHelpers';

export interface ICloneBaseVcsInput {
  readonly baseId: string;
  readonly atRevision?: number;
  readonly tableIds?: readonly string[];
  readonly endpoint?: string;
  readonly pgliteDir?: string;
  readonly headlessUrl?: string;
  readonly multiValueStrategy?: VcsMultiValueStrategy;
  readonly force?: boolean;
  readonly schemaOnly?: boolean;
  readonly chunkSize?: number;
  readonly includeSnapshot?: boolean;
  readonly checkpoint?: IBaseVcsSnapshot;
  readonly adoptCheckpoint?: boolean;
}

export interface ICloneBaseVcsOutput {
  readonly config: IVcsWorkspaceConfig;
  readonly snapshot: IBaseVcsSnapshot;
  readonly remoteMode: VcsRemoteMode;
  readonly summary: IBaseVcsPatchSummary;
}

const DEFAULT_STREAM_CHUNK_SIZE = 500;

const isIgnorableEnableError = (error: DomainError): boolean =>
  error.tags.includes('forbidden') ||
  error.tags.includes('not-found') ||
  error.code === 'batch.cross_database_not_atomic' ||
  error.code === 'vcs.readonly_remote';

function summarizeClonedSchemaAndRecords(
  schemaSnapshot: IBaseVcsSnapshot,
  totalRecords: number
): IBaseVcsPatchSummary {
  let fieldsAdded = 0;
  let viewsAdded = 0;
  for (const table of schemaSnapshot.tables) {
    fieldsAdded += table.fields.length;
    viewsAdded += table.views.length;
  }
  return {
    tablesAdded: schemaSnapshot.tables.length,
    tablesDeleted: 0,
    tablesRenamed: 0,
    fieldsAdded,
    fieldsUpdated: 0,
    fieldsDeleted: 0,
    viewsAdded,
    viewsUpdated: 0,
    viewsDeleted: 0,
    recordsAdded: totalRecords,
    recordsUpdated: 0,
    recordsDeleted: 0,
    cellChanges: 0,
  };
}

@injectable()
export class CloneBaseVcsService {
  constructor(
    @inject(v2VcsClientTokens.remoteGateway)
    private readonly remoteGateway: IVcsRemoteGateway,
    @inject(v2VcsClientTokens.localEngine)
    private readonly localEngine: IVcsLocalEnginePort,
    @inject(v2VcsClientTokens.stateRepository)
    private readonly stateRepository: IVcsStateRepository
  ) {}

  private async ensureWorkspaceAvailable(
    baseId: string,
    force?: boolean
  ): Promise<Result<void, DomainError>> {
    const existingConfigRes = await this.stateRepository.readConfig();
    if (existingConfigRes.isErr()) return err(existingConfigRes.error);
    if (existingConfigRes.value?.readOnly) return err(readonlyCheckoutError());

    const hasBaseRes = await this.localEngine.hasBase(baseId);
    if (hasBaseRes.isErr()) return err(hasBaseRes.error);

    if ((existingConfigRes.value !== null || hasBaseRes.value) && !force) {
      return err(
        vcsDomainError.conflict({
          code: 'vcs.workspace_exists',
          message: `VCS workspace already exists for base ${existingConfigRes.value?.baseId ?? baseId}; pass force: true to overwrite`,
          details: { baseId },
        })
      );
    }

    return ok(undefined);
  }

  private async persistWorkspaceMetadata(
    config: IVcsWorkspaceConfig
  ): Promise<Result<void, DomainError>> {
    const writeConfigRes = await this.stateRepository.writeConfig(config);
    if (writeConfigRes.isErr()) return err(writeConfigRes.error);

    const writeConflictsRes = await this.stateRepository.writeConflicts([]);
    if (writeConflictsRes.isErr()) return err(writeConflictsRes.error);

    return this.stateRepository.writeMergeState(null);
  }

  private async persistClonedState(
    config: IVcsWorkspaceConfig,
    persistedSnapshot: IBaseVcsSnapshot
  ): Promise<Result<void, DomainError>> {
    const metaRes = await this.persistWorkspaceMetadata(config);
    if (metaRes.isErr()) return err(metaRes.error);
    return this.stateRepository.writeBaseSnapshot(persistedSnapshot);
  }

  private buildWorkspaceConfig(
    input: ICloneBaseVcsInput,
    persistedSnapshot: IBaseVcsSnapshot,
    remoteMode: VcsRemoteMode,
    schemaOnly?: boolean
  ): IVcsWorkspaceConfig {
    const clonedAt = new Date().toISOString();
    return {
      formatVersion: 1,
      baseId: persistedSnapshot.baseId,
      baseName: persistedSnapshot.baseName,
      ...(input.endpoint !== undefined ? { endpoint: input.endpoint } : {}),
      remoteMode,
      ...(input.pgliteDir !== undefined ? { pgliteDir: input.pgliteDir } : {}),
      ...(input.headlessUrl !== undefined ? { headlessUrl: input.headlessUrl } : {}),
      ...(input.tableIds !== undefined ? { selectedTables: [...input.tableIds] } : {}),
      ...(input.multiValueStrategy !== undefined
        ? { multiValueStrategy: input.multiValueStrategy }
        : {}),
      ...(persistedSnapshot.cursor !== undefined ? { pullCursor: persistedSnapshot.cursor } : {}),
      ...(schemaOnly ? { schemaOnly: true } : {}),
      ...(input.atRevision !== undefined ? { readOnly: true } : {}),
      clonedAt,
      cloneRevision: persistedSnapshot.revision,
      lastPulledAt: clonedAt,
      ...(input.checkpoint ? { promotionBaselineRevision: input.checkpoint.revision } : {}),
    };
  }

  private async ensureVcsEnabledIfSupported(baseId: string): Promise<Result<void, DomainError>> {
    if (!this.remoteGateway.enableBaseVcs) {
      return ok(undefined);
    }
    const enableRes = await this.remoteGateway.enableBaseVcs(baseId);
    if (enableRes.isErr() && !isIgnorableEnableError(enableRes.error)) {
      return err(enableRes.error);
    }
    return ok(undefined);
  }

  private async executeSchemaOnlyClone(
    input: ICloneBaseVcsInput
  ): Promise<Result<ICloneBaseVcsOutput, DomainError>> {
    const cloneRes = await this.remoteGateway.cloneSnapshot(input.baseId, {
      ...(input.tableIds ? { tableIds: input.tableIds } : {}),
      includeRecords: false,
    });
    if (cloneRes.isErr()) return err(cloneRes.error);

    if (input.force && this.localEngine.reset) {
      const resetRes = await this.localEngine.reset();
      if (resetRes.isErr()) return err(resetRes.error);
    }

    const { snapshot: rawSnapshot, remoteMode } = cloneRes.value;
    const schemaSnapshot = canonicalizeSnapshot(
      {
        ...rawSnapshot,
        tables: rawSnapshot.tables.map((t) => ({ ...t, records: [] })),
      },
      { preserveComputed: true }
    );

    const engineRes = await runWithEngineSession(this.localEngine, async (engine) => {
      const hydRes = await engine.hydrateSnapshot(schemaSnapshot, { skipCaptureSnapshot: true });
      if (hydRes.isErr()) return err(hydRes.error);
      if (engine.markWorkingClean) {
        const cleanRes = await engine.markWorkingClean(schemaSnapshot.baseId);
        if (cleanRes.isErr()) return err(cleanRes.error);
      }
      return ok(undefined);
    });
    if (engineRes.isErr()) return err(engineRes.error);

    const config = this.buildWorkspaceConfig(input, schemaSnapshot, remoteMode, true);
    if (this.stateRepository.writeBaseSchemaSnapshot) {
      const metaRes = await this.persistWorkspaceMetadata(config);
      if (metaRes.isErr()) return err(metaRes.error);
      const writeSchemaRes = await this.stateRepository.writeBaseSchemaSnapshot(schemaSnapshot);
      if (writeSchemaRes.isErr()) return err(writeSchemaRes.error);
    } else {
      const persistRes = await this.persistClonedState(config, schemaSnapshot);
      if (persistRes.isErr()) return err(persistRes.error);
    }

    return ok({
      config,
      snapshot: schemaSnapshot,
      remoteMode,
      summary: summarizeClonedSchemaAndRecords(schemaSnapshot, 0),
    });
  }

  private async executeMonolithicClone(
    input: ICloneBaseVcsInput,
    prefetched?: { snapshot: IBaseVcsSnapshot; remoteMode: VcsRemoteMode }
  ): Promise<Result<ICloneBaseVcsOutput, DomainError>> {
    const resolved = prefetched
      ? ok(prefetched)
      : await this.remoteGateway.cloneSnapshot(
          input.baseId,
          input.tableIds ? { tableIds: input.tableIds } : undefined
        );
    if (resolved.isErr()) {
      return err(resolved.error);
    }

    const { snapshot: rawSnapshot, remoteMode } = resolved.value;
    const remoteSnapshot = canonicalizeSnapshot(rawSnapshot, { preserveComputed: true });
    const historical = input.atRevision !== undefined;
    const engineSnapshot =
      historical && (remoteSnapshot.accessScope || input.tableIds)
        ? historicalEngineSnapshot(remoteSnapshot)
        : remoteSnapshot;

    const hydrateRes = await runWithEngineSession(this.localEngine, async (engine) => {
      const hyd = await engine.hydrateSnapshot(engineSnapshot, { skipCaptureSnapshot: historical });
      if (hyd.isErr()) return err(hyd.error);
      if (engine.markWorkingClean) {
        const cleanRes = await engine.markWorkingClean(remoteSnapshot.baseId);
        if (cleanRes.isErr()) return err(cleanRes.error);
      }
      return hyd;
    });
    if (hydrateRes.isErr()) return err(hydrateRes.error);

    const persistedSnapshot =
      !historical && hydrateRes.value.snapshot
        ? canonicalizeSnapshot(
            {
              ...hydrateRes.value.snapshot,
              revision: rawSnapshot.revision,
              ...(rawSnapshot.cursor !== undefined ? { cursor: rawSnapshot.cursor } : {}),
              ...(rawSnapshot.accessScope ? { accessScope: rawSnapshot.accessScope } : {}),
            },
            { preserveComputed: true }
          )
        : remoteSnapshot;

    const config = this.buildWorkspaceConfig(
      input,
      persistedSnapshot,
      remoteMode,
      input.schemaOnly
    );
    const persistRes = await this.persistClonedState(config, persistedSnapshot);
    if (persistRes.isErr()) return err(persistRes.error);

    const totalRecords = persistedSnapshot.tables.reduce(
      (sum, table) => sum + table.records.length,
      0
    );
    const summary = summarizeClonedSchemaAndRecords(persistedSnapshot, totalRecords);

    return ok({
      config,
      snapshot: persistedSnapshot,
      remoteMode,
      summary,
    });
  }

  private supportsStreamingClone(): boolean {
    return Boolean(
      this.remoteGateway.cloneTableRecordsChunk &&
      this.localEngine.hydrateRecordChunk &&
      this.localEngine.captureTableRecordsChunk &&
      this.stateRepository.writeBaseSchemaSnapshot &&
      this.stateRepository.applyBaseStateMutations
    );
  }

  private async processSingleStreamChunk(params: {
    readonly engine: IVcsLocalEnginePort;
    readonly baseId: string;
    readonly tableId: string;
    readonly chunk: {
      readonly records: readonly IRecordVcsSnapshot[];
    };
    readonly versionMap: Map<string, number>;
    readonly deferredLinks: Array<{
      readonly id: string;
      readonly fields: Record<string, unknown>;
    }>;
  }): Promise<Result<void, DomainError>> {
    for (const rec of params.chunk.records) {
      if (rec.version !== undefined) {
        params.versionMap.set(rec.id, rec.version);
      }
    }
    if (params.chunk.records.length === 0) return ok(undefined);

    const hydChunkRes = await params.engine.hydrateRecordChunk!({
      baseId: params.baseId,
      tableId: params.tableId,
      records: params.chunk.records,
      mode: 'scalar-insert',
    });
    if (hydChunkRes.isErr()) return err(hydChunkRes.error);
    params.deferredLinks.push(...hydChunkRes.value.deferredLinkRecords);
    return ok(undefined);
  }

  private async streamTableRecordChunks(params: {
    readonly engine: IVcsLocalEnginePort;
    readonly baseId: string;
    readonly tableId: string;
    readonly chunkSize: number;
    readonly anyChunkFetched: { value: boolean };
  }): Promise<
    Result<
      | { readonly fallbackNotFound: true }
      | {
          readonly fallbackNotFound: false;
          readonly versionMap: Map<string, number>;
          readonly deferredLinks: Array<{
            readonly id: string;
            readonly fields: Record<string, unknown>;
          }>;
        },
      DomainError
    >
  > {
    const versionMap = new Map<string, number>();
    const deferredLinks: Array<{ readonly id: string; readonly fields: Record<string, unknown> }> =
      [];
    let cursor: string | undefined;

    for (;;) {
      const chunkRes = await this.remoteGateway.cloneTableRecordsChunk!(
        params.baseId,
        params.tableId,
        { ...(cursor ? { cursor } : {}), limit: params.chunkSize }
      );
      if (chunkRes.isErr()) {
        if (!params.anyChunkFetched.value && chunkRes.error.tags.includes('not-found')) {
          return ok({ fallbackNotFound: true });
        }
        return err(chunkRes.error);
      }

      params.anyChunkFetched.value = true;
      const procRes = await this.processSingleStreamChunk({
        engine: params.engine,
        baseId: params.baseId,
        tableId: params.tableId,
        chunk: chunkRes.value,
        versionMap,
        deferredLinks,
      });
      if (procRes.isErr()) return err(procRes.error);

      if (!chunkRes.value.hasMore || !chunkRes.value.nextCursor) {
        return ok({ fallbackNotFound: false, versionMap, deferredLinks });
      }
      cursor = chunkRes.value.nextCursor;
    }
  }

  private async hydrateDeferredLinks(
    engine: IVcsLocalEnginePort,
    baseId: string,
    deferredLinksByTable: Map<
      string,
      Array<{ readonly id: string; readonly fields: Record<string, unknown> }>
    >,
    chunkSize: number
  ): Promise<Result<void, DomainError>> {
    for (const [tableId, linkRecs] of deferredLinksByTable.entries()) {
      for (let offset = 0; offset < linkRecs.length; offset += chunkSize) {
        const linkHydRes = await engine.hydrateRecordChunk!({
          baseId,
          tableId,
          records: linkRecs.slice(offset, offset + chunkSize),
          mode: 'link-update',
        });
        if (linkHydRes.isErr()) return err(linkHydRes.error);
      }
    }
    return ok(undefined);
  }

  private async persistCapturedChunkAndTrackEager(params: {
    readonly schemaSnapshot: IBaseVcsSnapshot;
    readonly tableId: string;
    readonly records: readonly IRecordVcsSnapshot[];
    readonly versionMap?: Map<string, number>;
    readonly tableEager: IRecordVcsSnapshot[];
    readonly eagerState: {
      totalCaptured: number;
      overflowed: boolean;
      readonly keepEager: boolean;
      readonly recordsByTable: Map<string, IRecordVcsSnapshot[]>;
    };
  }): Promise<Result<void, DomainError>> {
    const versionedRecords: IRecordVcsSnapshot[] = params.records.map((rec) => {
      const ver = params.versionMap?.get(rec.id);
      return ver !== undefined ? { ...rec, version: ver } : rec;
    });
    if (versionedRecords.length === 0) return ok(undefined);

    const mutRes = await this.stateRepository.applyBaseStateMutations!({
      revision: params.schemaSnapshot.revision,
      ...(params.schemaSnapshot.cursor !== undefined
        ? { cursor: params.schemaSnapshot.cursor }
        : {}),
      recordChanges: [{ tableId: params.tableId, upserts: versionedRecords }],
    });
    if (mutRes.isErr()) return err(mutRes.error);

    params.eagerState.totalCaptured += versionedRecords.length;
    if (params.eagerState.overflowed) return ok(undefined);

    if (
      params.eagerState.keepEager ||
      params.eagerState.totalCaptured <= EAGER_RETURN_SNAPSHOT_RECORD_LIMIT
    ) {
      params.tableEager.push(...versionedRecords);
    } else {
      params.eagerState.overflowed = true;
      params.eagerState.recordsByTable.clear();
    }
    return ok(undefined);
  }

  private async captureTableChunksToBaseline(params: {
    readonly engine: IVcsLocalEnginePort;
    readonly schemaSnapshot: IBaseVcsSnapshot;
    readonly tableId: string;
    readonly chunkSize: number;
    readonly versionMap?: Map<string, number>;
    readonly eagerState: {
      totalCaptured: number;
      overflowed: boolean;
      readonly keepEager: boolean;
      readonly recordsByTable: Map<string, IRecordVcsSnapshot[]>;
    };
  }): Promise<Result<void, DomainError>> {
    const tableEager: IRecordVcsSnapshot[] = [];
    let cursor: string | undefined;

    for (;;) {
      const capChunkRes = await params.engine.captureTableRecordsChunk!(
        params.schemaSnapshot.baseId,
        params.tableId,
        { ...(cursor ? { cursor } : {}), limit: params.chunkSize }
      );
      if (capChunkRes.isErr()) return err(capChunkRes.error);

      const persistRes = await this.persistCapturedChunkAndTrackEager({
        schemaSnapshot: params.schemaSnapshot,
        tableId: params.tableId,
        records: capChunkRes.value.records,
        versionMap: params.versionMap,
        tableEager,
        eagerState: params.eagerState,
      });
      if (persistRes.isErr()) return err(persistRes.error);

      if (!capChunkRes.value.hasMore || !capChunkRes.value.nextCursor) {
        break;
      }
      cursor = capChunkRes.value.nextCursor;
    }

    if (!params.eagerState.overflowed) {
      params.eagerState.recordsByTable.set(params.tableId, tableEager);
    }
    return ok(undefined);
  }

  private async captureStreamedBaseline(
    engine: IVcsLocalEnginePort,
    schemaSnapshot: IBaseVcsSnapshot,
    chunkSize: number,
    serverVersionsByTable: Map<string, Map<string, number>>,
    keepEager: boolean
  ): Promise<
    Result<
      { readonly totalCaptured: number; readonly returnedSnapshot: IBaseVcsSnapshot },
      DomainError
    >
  > {
    const writeSchemaRes = await this.stateRepository.writeBaseSchemaSnapshot!(schemaSnapshot);
    if (writeSchemaRes.isErr()) return err(writeSchemaRes.error);

    const eagerState = {
      totalCaptured: 0,
      overflowed: false,
      keepEager,
      recordsByTable: new Map<string, IRecordVcsSnapshot[]>(),
    };

    for (const table of schemaSnapshot.tables) {
      const capRes = await this.captureTableChunksToBaseline({
        engine,
        schemaSnapshot,
        tableId: table.id,
        chunkSize,
        versionMap: serverVersionsByTable.get(table.id),
        eagerState,
      });
      if (capRes.isErr()) return err(capRes.error);
    }

    if (engine.markWorkingClean) {
      const cleanRes = await engine.markWorkingClean(schemaSnapshot.baseId);
      if (cleanRes.isErr()) return err(cleanRes.error);
    }

    const eagerSnapshot = eagerState.overflowed
      ? undefined
      : canonicalizeSnapshot(
          {
            ...schemaSnapshot,
            tables: schemaSnapshot.tables.map((t): ITableVcsSnapshot => ({
              ...t,
              records: eagerState.recordsByTable.get(t.id) ?? [],
            })),
          },
          { preserveComputed: true }
        );

    if (eagerSnapshot && eagerState.totalCaptured <= EAGER_RETURN_SNAPSHOT_RECORD_LIMIT) {
      const writeCompatRes = await this.stateRepository.writeBaseSnapshot(eagerSnapshot);
      if (writeCompatRes.isErr()) return err(writeCompatRes.error);
    }

    return ok({
      totalCaptured: eagerState.totalCaptured,
      returnedSnapshot: eagerSnapshot ?? schemaSnapshot,
    });
  }

  private async runStreamingCloneSession(
    input: ICloneBaseVcsInput,
    schemaSnapshot: IBaseVcsSnapshot,
    chunkSize: number
  ): Promise<
    Result<
      | { readonly fallback: true }
      | {
          readonly fallback: false;
          readonly totalCaptured: number;
          readonly returnedSnapshot: IBaseVcsSnapshot;
        },
      DomainError
    >
  > {
    return runWithEngineSession(this.localEngine, async (engine) => {
      const initHydrate = await engine.hydrateSnapshot(schemaSnapshot, {
        skipCaptureSnapshot: true,
      });
      if (initHydrate.isErr()) return err(initHydrate.error);

      const serverVersionsByTable = new Map<string, Map<string, number>>();
      const deferredLinksByTable = new Map<
        string,
        Array<{ readonly id: string; readonly fields: Record<string, unknown> }>
      >();
      const anyChunkFetched = { value: false };

      for (const table of schemaSnapshot.tables) {
        const tableStreamRes = await this.streamTableRecordChunks({
          engine,
          baseId: input.baseId,
          tableId: table.id,
          chunkSize,
          anyChunkFetched,
        });
        if (tableStreamRes.isErr()) return err(tableStreamRes.error);
        if (tableStreamRes.value.fallbackNotFound) {
          return ok({ fallback: true as const });
        }
        serverVersionsByTable.set(table.id, tableStreamRes.value.versionMap);
        if (tableStreamRes.value.deferredLinks.length > 0) {
          deferredLinksByTable.set(table.id, tableStreamRes.value.deferredLinks);
        }
      }

      const linksRes = await this.hydrateDeferredLinks(
        engine,
        input.baseId,
        deferredLinksByTable,
        chunkSize
      );
      if (linksRes.isErr()) return err(linksRes.error);

      if (engine.flushComputed) {
        const flushRes = await engine.flushComputed(input.baseId);
        if (flushRes.isErr()) return err(flushRes.error);
      }

      const baselineRes = await this.captureStreamedBaseline(
        engine,
        schemaSnapshot,
        chunkSize,
        serverVersionsByTable,
        Boolean(input.includeSnapshot)
      );
      if (baselineRes.isErr()) return err(baselineRes.error);

      return ok({
        fallback: false as const,
        totalCaptured: baselineRes.value.totalCaptured,
        returnedSnapshot: baselineRes.value.returnedSnapshot,
      });
    });
  }

  private async executeStreamingClone(
    input: ICloneBaseVcsInput
  ): Promise<Result<ICloneBaseVcsOutput, DomainError>> {
    const chunkSize = Math.min(
      2_000,
      Math.max(1, Math.floor(input.chunkSize ?? DEFAULT_STREAM_CHUNK_SIZE))
    );

    const schemaCloneRes = await this.remoteGateway.cloneSnapshot(input.baseId, {
      ...(input.tableIds ? { tableIds: input.tableIds } : {}),
      includeRecords: false,
    });
    if (schemaCloneRes.isErr()) return err(schemaCloneRes.error);

    const { snapshot: rawSchema, remoteMode } = schemaCloneRes.value;
    if (rawSchema.tables.some((t) => t.records.length > 0)) {
      return this.executeMonolithicClone(input, schemaCloneRes.value);
    }

    const schemaSnapshot = canonicalizeSnapshot(rawSchema, { preserveComputed: true });
    const sessionRes = await this.runStreamingCloneSession(input, schemaSnapshot, chunkSize);
    if (sessionRes.isErr()) return err(sessionRes.error);
    if (sessionRes.value.fallback) {
      return this.executeMonolithicClone(input);
    }

    const config = this.buildWorkspaceConfig(input, schemaSnapshot, remoteMode);
    const metaRes = await this.persistWorkspaceMetadata(config);
    if (metaRes.isErr()) return err(metaRes.error);

    return ok({
      config,
      snapshot: sessionRes.value.returnedSnapshot,
      remoteMode,
      summary: summarizeClonedSchemaAndRecords(schemaSnapshot, sessionRes.value.totalCaptured),
    });
  }

  private async checkoutRevision(
    input: ICloneBaseVcsInput,
    revision: number
  ): Promise<Result<ICloneBaseVcsOutput, DomainError>> {
    if (!this.remoteGateway.checkoutRevision) {
      return err(
        vcsDomainError.notFound({
          code: 'vcs.history_unavailable',
          message: 'This remote does not support historical checkouts.',
        })
      );
    }
    const result = await this.remoteGateway.checkoutRevision(input.baseId, revision);
    if (result.isErr()) return err(result.error);
    const { snapshot, remoteMode } = result.value;
    if (snapshot.baseId !== input.baseId || snapshot.revision !== revision) {
      return err(
        vcsDomainError.infrastructure({
          code: 'vcs.checkout_mismatch',
          message: 'Checkout response does not match the requested base and revision.',
        })
      );
    }
    const selected = input.tableIds ? new Set(input.tableIds) : undefined;
    const tables = selected ? snapshot.tables.filter((t) => selected.has(t.id)) : snapshot.tables;
    if (input.force && this.localEngine.reset) {
      const reset = await this.localEngine.reset();
      if (reset.isErr()) return err(reset.error);
    }
    return this.executeMonolithicClone(input, {
      remoteMode,
      snapshot: {
        ...snapshot,
        tables: input.schemaOnly ? tables.map((t) => ({ ...t, records: [] })) : tables,
        ...(snapshot.accessScope && selected
          ? {
              accessScope: {
                tables: Object.fromEntries(
                  Object.entries(snapshot.accessScope.tables).filter(([id]) => selected.has(id))
                ),
              },
            }
          : {}),
      },
    });
  }

  private async adoptCheckpoint(
    checkpoint: IBaseVcsSnapshot
  ): Promise<Result<ICloneBaseVcsOutput, DomainError>> {
    const incompatible = (message: string) =>
      err(
        vcsDomainError.conflict({
          code: 'vcs.promotion_adoption_conflict',
          message,
        })
      );
    const configRes = await this.stateRepository.readConfig();
    if (configRes.isErr()) return err(configRes.error);
    const config = configRes.value;
    if (
      !config ||
      config.baseId !== checkpoint.baseId ||
      config.remoteMode !== 'v2-vcs' ||
      config.headlessUrl !== undefined ||
      config.readOnly ||
      config.selectedTables !== undefined ||
      config.schemaOnly
    ) {
      return incompatible(
        'Back up or move the incompatible working copy before initializing Data PRs. No files were replaced.'
      );
    }
    if (config.promotionBaselineRevision !== undefined) {
      const stored = await this.stateRepository.readBaseSnapshot();
      if (stored.isErr()) return err(stored.error);
      const baseline = stored.value;
      if (
        !baseline ||
        baseline.baseId !== checkpoint.baseId ||
        baseline.accessScope ||
        config.promotionBaselineRevision > baseline.revision
      ) {
        return incompatible(
          'The Builder checkpoint revision is inconsistent. Back up the clone and move it aside before initializing again.'
        );
      }
      const count = baseline.tables.reduce((total, table) => total + table.records.length, 0);
      return ok({
        config,
        snapshot: baseline,
        remoteMode: config.remoteMode,
        summary: summarizeClonedSchemaAndRecords(baseline, count),
      });
    }

    // Hold the local PGlite owner through inspection and enrollment. A live legacy serve must
    // be stopped by its owner before adoption, so changes cannot slip past the clean check.
    return runWithEngineSession(this.localEngine, async (engine) => {
      const loaded = await loadVcsWorkspace(this.stateRepository, engine);
      if (loaded.isErr()) return err(loaded.error);
      const { baseSnapshot, workingSnapshot, conflicts } = loaded.value;
      if (
        baseSnapshot.baseId !== checkpoint.baseId ||
        baseSnapshot.accessScope ||
        conflicts.length
      ) {
        return incompatible(
          'Back up or move the incompatible working copy before initializing Data PRs. No files were replaced.'
        );
      }
      const patch = diffSnapshots(baseSnapshot, workingSnapshot);
      if (!isEmptyPatch(patch)) {
        return incompatible(
          'The existing clone has local edits. Preserve those edits in a separate checkout and initialize a clean Data PR working copy.'
        );
      }
      if (
        baseSnapshot.revision !== checkpoint.revision ||
        baseSnapshot.baseName !== checkpoint.baseName ||
        !isEmptyPatch(diffSnapshots(baseSnapshot, alignSourceSnapshot(checkpoint, baseSnapshot)))
      ) {
        return incompatible(
          'The clean clone does not match the current immutable checkpoint. Pull the current base or move the old clone aside, then initialize again.'
        );
      }
      const next = { ...config, promotionBaselineRevision: checkpoint.revision };
      const saved = await this.stateRepository.writeConfig(next);
      if (saved.isErr()) return err(saved.error);
      return ok({
        config: next,
        snapshot: baseSnapshot,
        remoteMode: next.remoteMode,
        summary: summarizePatch(patch),
      });
    });
  }

  async execute(input: ICloneBaseVcsInput): Promise<Result<ICloneBaseVcsOutput, DomainError>> {
    if (input.atRevision !== undefined && !input.checkpoint) {
      const available = await this.ensureWorkspaceAvailable(input.baseId, input.force);
      return available.isErr()
        ? err(available.error)
        : this.checkoutRevision(input, input.atRevision);
    }
    if (input.checkpoint) {
      const snapshot = input.checkpoint;
      if (
        snapshot.baseId !== input.baseId ||
        !Number.isSafeInteger(snapshot.revision) ||
        snapshot.revision < 0 ||
        snapshot.accessScope ||
        input.atRevision !== undefined ||
        input.force ||
        input.schemaOnly ||
        input.tableIds ||
        input.headlessUrl
      ) {
        return err(
          vcsDomainError.validation({
            code: 'vcs.invalid_checkpoint_clone',
            message: 'A complete base checkpoint is required to initialize this working copy.',
          })
        );
      }
      if (input.adoptCheckpoint) return this.adoptCheckpoint(snapshot);
      const available = await this.ensureWorkspaceAvailable(input.baseId);
      if (available.isErr()) return err(available.error);
      return this.executeMonolithicClone(input, { snapshot, remoteMode: 'v2-vcs' });
    }

    const availableRes = await this.ensureWorkspaceAvailable(input.baseId, input.force);
    if (availableRes.isErr()) return err(availableRes.error);

    const enableRes = await this.ensureVcsEnabledIfSupported(input.baseId);
    if (enableRes.isErr()) return err(enableRes.error);

    if (input.schemaOnly) {
      return this.executeSchemaOnlyClone(input);
    }

    if (input.force && this.localEngine.reset) {
      const resetRes = await this.localEngine.reset();
      if (resetRes.isErr()) return err(resetRes.error);
    }

    return this.supportsStreamingClone()
      ? this.executeStreamingClone(input)
      : this.executeMonolithicClone(input);
  }
}
