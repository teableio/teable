import { randomUUID } from 'node:crypto';
import type { DomainError } from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { applyPatchToSnapshot } from '../../adapters/memory';
import { applyIncrementalChanges } from '../../domain/applyIncrementalChanges';
import {
  adjustPatchAfterCommittedDeletes,
  buildNonCanonicalSymmetricLinkSyncBatch,
  collectNonCanonicalSymmetricLinkTargetIds,
  collectTouchedRecordIdsForBatchMutation,
  DEFAULT_MAX_RECORD_OPS_PER_PUSH_BATCH,
  patchToBaselineMutationBatch,
  planPatchBatches,
} from '../../domain/chunkPatch';
import { diffSnapshots, isEmptyPatch, summarizePatch } from '../../domain/diffSnapshots';
import { vcsDomainError } from '../../domain/errors';
import { canonicalizeSnapshot } from '../../domain/fieldClassification';
import type {
  IBaseVcsPatch,
  IBaseVcsSnapshot,
  IFieldVcsSnapshot,
  IRecordVcsSnapshot,
  ITableVcsSnapshot,
  IVcsPushResult,
} from '../../domain/types';
import {
  v2VcsClientTokens,
  type IVcsLocalEnginePort,
  type IVcsRemoteGateway,
  type IVcsStateRepository,
  type IVcsWorkspaceConfig,
} from '../../ports';
import {
  fetchRemoteIncrementalState,
  fetchRemoteLiveState,
  loadIndexedWorkspaceDiff,
  runWithEngineSession,
} from './workspaceHelpers';

export interface IPushBaseVcsInput {
  readonly dryRun?: boolean;
  readonly message?: string;
  readonly originPushId?: string;
  readonly maxBatchSize?: number;
}

function collectDeletedRecordIdsFromPatch(
  patch: IBaseVcsPatch,
  target: Map<string, Set<string>>
): void {
  for (const tp of patch.tablesUpdated) {
    if (tp.recordsDeleted.length === 0) continue;
    let set = target.get(tp.tableId);
    if (!set) {
      set = new Set();
      target.set(tp.tableId, set);
    }
    for (const del of tp.recordsDeleted) {
      set.add(del.recordId);
    }
  }
}

@injectable()
export class PushBaseVcsService {
  constructor(
    @inject(v2VcsClientTokens.remoteGateway)
    private readonly remoteGateway: IVcsRemoteGateway,
    @inject(v2VcsClientTokens.localEngine)
    private readonly localEngine: IVcsLocalEnginePort,
    @inject(v2VcsClientTokens.stateRepository)
    private readonly stateRepository: IVcsStateRepository
  ) {}

  private mergeSyncedRecordVersions(
    syncedServerSnap: IBaseVcsSnapshot,
    hydratedSnap: IBaseVcsSnapshot
  ): IBaseVcsSnapshot {
    const serverVersionByTable = new Map(
      syncedServerSnap.tables.map((t) => [
        t.id,
        new Map(t.records.filter((r) => r.version !== undefined).map((r) => [r.id, r.version!])),
      ])
    );
    return {
      ...hydratedSnap,
      tables: hydratedSnap.tables.map((table) => {
        const verMap = serverVersionByTable.get(table.id);
        if (!verMap || verMap.size === 0) return table;
        return {
          ...table,
          records: table.records.map((rec) => {
            const serverVer = verMap.get(rec.id);
            return serverVer !== undefined ? { ...rec, version: serverVer } : rec;
          }),
        };
      }),
    };
  }

  private async loadExistingRecordsForBatch(
    patch: IBaseVcsPatch,
    existingTableSchemas: ReadonlyMap<string, ITableVcsSnapshot>
  ): Promise<Result<Map<string, ReadonlyMap<string, IRecordVcsSnapshot>>, DomainError>> {
    const existingBaseRecordsByTable = new Map<string, ReadonlyMap<string, IRecordVcsSnapshot>>();
    if (!this.stateRepository.readBaseRecordsByIds) {
      return ok(existingBaseRecordsByTable);
    }
    const touchedIds = collectTouchedRecordIdsForBatchMutation(patch, existingTableSchemas);
    for (const [tableId, ids] of touchedIds.entries()) {
      if (ids.length === 0) continue;
      const recsRes = await this.stateRepository.readBaseRecordsByIds(tableId, ids);
      if (recsRes.isErr()) return err(recsRes.error);
      existingBaseRecordsByTable.set(tableId, recsRes.value);
    }
    return ok(existingBaseRecordsByTable);
  }

  private async persistBatchBaseline(params: {
    readonly currentSchema: IBaseVcsSnapshot;
    readonly patch: IBaseVcsPatch;
    readonly newRevision: number;
    readonly workingRecordsByTable: ReadonlyMap<string, ReadonlyMap<string, IRecordVcsSnapshot>>;
  }): Promise<Result<void, DomainError>> {
    if (!this.stateRepository.applyBaseStateMutations) {
      const fullBaseRes = await this.stateRepository.readBaseSnapshot();
      if (fullBaseRes.isErr()) return err(fullBaseRes.error);
      if (!fullBaseRes.value) return ok(undefined);
      const nextFull = applyPatchToSnapshot(fullBaseRes.value, params.patch, {
        revision: params.newRevision,
        preserveComputed: true,
      });
      return this.stateRepository.writeBaseSnapshot(nextFull);
    }

    const existingTableSchemas = new Map<string, ITableVcsSnapshot>(
      params.currentSchema.tables.map((t) => [t.id, t])
    );
    const existingRecsRes = await this.loadExistingRecordsForBatch(
      params.patch,
      existingTableSchemas
    );
    if (existingRecsRes.isErr()) return err(existingRecsRes.error);

    const mutationBatch = patchToBaselineMutationBatch(params.patch, {
      newRevision: params.newRevision,
      ...(params.currentSchema.cursor !== undefined ? { cursor: params.currentSchema.cursor } : {}),
      ...(params.currentSchema.accessScope !== undefined
        ? { accessScope: params.currentSchema.accessScope }
        : {}),
      existingTableSchemas,
      existingBaseRecordsByTable: existingRecsRes.value,
      workingRecordsByTable: params.workingRecordsByTable,
    });
    return this.stateRepository.applyBaseStateMutations(mutationBatch);
  }

  private async checkpointCommittedBatch(params: {
    readonly config: IVcsWorkspaceConfig;
    readonly currentSchema: IBaseVcsSnapshot;
    readonly patch: IBaseVcsPatch;
    readonly newRevision: number;
    readonly batchOriginPushId: string;
    readonly committedOriginPushIds: readonly string[];
    readonly workingRecordsByTable: ReadonlyMap<string, ReadonlyMap<string, IRecordVcsSnapshot>>;
  }): Promise<Result<IBaseVcsSnapshot, DomainError>> {
    const baseRes = await this.persistBatchBaseline(params);
    if (baseRes.isErr()) return err(baseRes.error);

    const writeCfg = await this.stateRepository.writeConfig({
      ...params.config,
      lastOriginPushId: params.batchOriginPushId,
      lastOriginPushIds: [...params.committedOriginPushIds],
      lastPushedAt: new Date().toISOString(),
    });
    if (writeCfg.isErr()) return err(writeCfg.error);

    if (this.stateRepository.readBaseSchemaSnapshot) {
      const updatedSchemaRes = await this.stateRepository.readBaseSchemaSnapshot();
      if (updatedSchemaRes.isOk() && updatedSchemaRes.value) {
        return ok(updatedSchemaRes.value.schemaSnapshot);
      }
    }

    return ok({
      ...params.currentSchema,
      revision: params.newRevision,
    });
  }

  private async syncNonCanonicalSymmetricLinksAfterMultiBatch(params: {
    readonly fullPatch: IBaseVcsPatch;
    readonly currentSchema: IBaseVcsSnapshot;
  }): Promise<Result<void, DomainError>> {
    if (
      !this.stateRepository.readBaseRecordsByIds ||
      !this.stateRepository.applyBaseStateMutations
    ) {
      return ok(undefined);
    }
    const existingTableSchemas = new Map<string, ITableVcsSnapshot>(
      params.currentSchema.tables.map((t) => [t.id, t])
    );
    const targetIds = collectNonCanonicalSymmetricLinkTargetIds(
      params.fullPatch,
      existingTableSchemas
    );
    if (targetIds.size === 0) {
      return ok(undefined);
    }

    const currentRecordsByTable = new Map<string, ReadonlyMap<string, IRecordVcsSnapshot>>();
    for (const [tableId, ids] of targetIds.entries()) {
      if (ids.length === 0) continue;
      const recRes = await this.stateRepository.readBaseRecordsByIds(tableId, ids);
      if (recRes.isErr()) return err(recRes.error);
      currentRecordsByTable.set(tableId, recRes.value);
    }

    const syncBatch = buildNonCanonicalSymmetricLinkSyncBatch(params.fullPatch, {
      existingTableSchemas,
      currentRecordsByTable,
    });
    if (syncBatch.recordChanges.length === 0) {
      return ok(undefined);
    }
    return this.stateRepository.applyBaseStateMutations({
      recordChanges: syncBatch.recordChanges,
    });
  }

  private async syncPostRebasedFullFallback(params: {
    readonly config: IVcsWorkspaceConfig;
    readonly initialBaseSchema: IBaseVcsSnapshot;
    readonly finalRevision: number;
    readonly lastOriginPushId: string;
    readonly committedOriginPushIds: readonly string[];
  }): Promise<Result<void, DomainError>> {
    const initialCursor = params.config.pullCursor ?? params.initialBaseSchema.cursor;
    const liveRes = await fetchRemoteLiveState(this.remoteGateway, params.config, {
      ...params.initialBaseSchema,
    });
    if (liveRes.isErr()) return err(liveRes.error);

    const syncedCursor = liveRes.value.snapshot.cursor ?? initialCursor;
    const targetSnap = canonicalizeSnapshot(
      {
        ...liveRes.value.snapshot,
        revision: params.finalRevision,
        capturedAt: new Date().toISOString(),
        ...(syncedCursor !== undefined ? { cursor: syncedCursor } : {}),
      },
      { preserveComputed: true }
    );

    const hydrateRes = await runWithEngineSession(this.localEngine, async (engine) => {
      const hyd = await engine.hydrateSnapshot(targetSnap);
      if (hyd.isErr()) return err(hyd.error);
      await engine.markWorkingClean?.(params.config.baseId);
      return hyd;
    });
    if (hydrateRes.isErr()) return err(hydrateRes.error);

    const baseSource = hydrateRes.value.snapshot
      ? this.mergeSyncedRecordVersions(targetSnap, hydrateRes.value.snapshot)
      : targetSnap;
    const nextBase = canonicalizeSnapshot(
      {
        ...baseSource,
        revision: params.finalRevision,
        ...(syncedCursor !== undefined ? { cursor: syncedCursor } : {}),
        ...(targetSnap.accessScope ? { accessScope: targetSnap.accessScope } : {}),
      },
      { preserveComputed: true }
    );

    const writeBase = await this.stateRepository.writeBaseSnapshot(nextBase);
    if (writeBase.isErr()) return err(writeBase.error);

    return this.stateRepository.writeConfig({
      ...params.config,
      ...(syncedCursor !== undefined ? { pullCursor: syncedCursor } : {}),
      lastOriginPushId: params.lastOriginPushId,
      lastOriginPushIds: [...params.committedOriginPushIds],
      lastPushedAt: new Date().toISOString(),
    });
  }

  private async syncPostRebasedIndexed(params: {
    readonly config: IVcsWorkspaceConfig;
    readonly initialBaseSchema: IBaseVcsSnapshot;
    readonly finalRevision: number;
    readonly lastOriginPushId: string;
    readonly committedOriginPushIds: readonly string[];
  }): Promise<Result<void, DomainError>> {
    if (
      !this.stateRepository.readBaseRecordsByIds ||
      !this.stateRepository.applyBaseStateMutations
    ) {
      return this.syncPostRebasedFullFallback(params);
    }

    const remoteStateRes = await fetchRemoteIncrementalState(
      this.remoteGateway,
      params.config,
      params.initialBaseSchema
    );
    if (remoteStateRes.isErr()) return err(remoteStateRes.error);
    const remoteState = remoteStateRes.value;

    if (!remoteState.isIncremental || !remoteState.changes) {
      return this.syncPostRebasedFullFallback(params);
    }

    const currentLoadedRes = await loadIndexedWorkspaceDiff(
      this.stateRepository,
      this.localEngine,
      {
        extraTouchedRecordIdsByTable: remoteState.touchedRecordIdsByTable,
        forceFullRecordTables: remoteState.deletedTableIds,
      }
    );
    if (currentLoadedRes.isErr()) return err(currentLoadedRes.error);

    const nextCursor =
      remoteState.changes.nextCursor ?? params.config.pullCursor ?? params.initialBaseSchema.cursor;
    const appliedTheirs = applyIncrementalChanges(
      currentLoadedRes.value.baseSnapshot,
      remoteState.changes
    );
    const theirsWithMeta = canonicalizeSnapshot(
      {
        ...appliedTheirs,
        revision: params.finalRevision,
        ...(nextCursor !== undefined ? { cursor: nextCursor } : {}),
        ...(remoteState.changes.accessScope
          ? { accessScope: remoteState.changes.accessScope }
          : {}),
      },
      { preserveComputed: true }
    );

    const deltaToLocal = diffSnapshots(currentLoadedRes.value.workingSnapshot, theirsWithMeta);
    const engineRes = await runWithEngineSession(this.localEngine, async (engine) => {
      if (!isEmptyPatch(deltaToLocal)) {
        const applyRes = await engine.applyPatch(params.config.baseId, deltaToLocal, {
          skipCaptureSnapshot: true,
        });
        if (applyRes.isErr()) return err(applyRes.error);
      }

      const postDeltaByTable = new Map<string, Map<string, IRecordVcsSnapshot>>();
      if (engine.captureWorkingDelta) {
        const postDeltaRes = await engine.captureWorkingDelta(params.config.baseId, {
          baseName: theirsWithMeta.baseName,
          revision: params.finalRevision,
        });
        if (postDeltaRes.isOk()) {
          for (const [tid, td] of postDeltaRes.value.tableDeltas.entries()) {
            postDeltaByTable.set(tid, new Map(td.upsertedRecords.map((r) => [r.id, r])));
          }
        }
      }

      const cleanRes = await engine.markWorkingClean?.(params.config.baseId);
      if (cleanRes?.isErr()) return err(cleanRes.error);

      return ok(postDeltaByTable);
    });
    if (engineRes.isErr()) return err(engineRes.error);
    const postDeltaByTable = engineRes.value;

    const existingTableSchemas = new Map<string, ITableVcsSnapshot>(
      currentLoadedRes.value.baseSchema.tables.map((t) => [t.id, t])
    );
    const mutBatch = patchToBaselineMutationBatch(
      diffSnapshots(currentLoadedRes.value.baseSnapshot, theirsWithMeta),
      {
        newRevision: params.finalRevision,
        ...(nextCursor !== undefined ? { cursor: nextCursor } : {}),
        baseName: theirsWithMeta.baseName,
        ...(theirsWithMeta.accessScope ? { accessScope: theirsWithMeta.accessScope } : {}),
        existingTableSchemas,
        existingBaseRecordsByTable: new Map(
          currentLoadedRes.value.baseSnapshot.tables.map((t) => [
            t.id,
            new Map(t.records.map((r) => [r.id, r])),
          ])
        ),
      }
    );

    const adjustedRecordChanges = mutBatch.recordChanges.map((rc) => {
      const postMap = postDeltaByTable.get(rc.tableId);
      if (!postMap) return rc;
      const versionById = new Map<string, number>();
      for (const delta of remoteState.changes!.recordDeltas) {
        if (delta.tableId === rc.tableId) {
          for (const r of delta.upserts) {
            if (r.version !== undefined) versionById.set(r.id, r.version);
          }
        }
      }
      return {
        ...rc,
        upserts: rc.upserts.map((rec) => {
          const postRec = postMap.get(rec.id);
          const remoteVer = versionById.get(rec.id) ?? rec.version;
          return postRec
            ? { ...postRec, ...(remoteVer !== undefined ? { version: remoteVer } : {}) }
            : rec;
        }),
      };
    });

    const mutRes = await this.stateRepository.applyBaseStateMutations({
      ...mutBatch,
      recordChanges: adjustedRecordChanges,
    });
    if (mutRes.isErr()) return err(mutRes.error);

    return this.stateRepository.writeConfig({
      ...params.config,
      baseName: theirsWithMeta.baseName,
      ...(nextCursor !== undefined ? { pullCursor: nextCursor } : {}),
      lastOriginPushId: params.lastOriginPushId,
      lastOriginPushIds: [...params.committedOriginPushIds],
      lastPushedAt: new Date().toISOString(),
    });
  }

  private async finalizeCommittedPushState(params: {
    readonly config: IVcsWorkspaceConfig;
    readonly initialBaseSchema: IBaseVcsSnapshot;
    readonly finalRevision: number;
    readonly lastOriginPushId: string;
    readonly committedOriginPushIds: readonly string[];
    readonly rebased: boolean;
    readonly isIndexed: boolean;
  }): Promise<Result<void, DomainError>> {
    if (params.rebased) {
      return params.isIndexed
        ? this.syncPostRebasedIndexed(params)
        : this.syncPostRebasedFullFallback(params);
    }
    if (this.localEngine.markWorkingClean) {
      return runWithEngineSession(this.localEngine, (engine) =>
        engine.markWorkingClean!(params.config.baseId)
      );
    }
    return ok(undefined);
  }

  private async runDryRunMultiBatchPush(params: {
    readonly baseId: string;
    readonly initialRevision: number;
    readonly firstBatch: IBaseVcsPatch;
    readonly fullPatch: IBaseVcsPatch;
    readonly rootOriginPushId: string;
    readonly totalBatches: number;
    readonly message?: string;
  }): Promise<Result<IVcsPushResult, DomainError>> {
    const checkRes = await this.remoteGateway.pushPatch({
      baseId: params.baseId,
      baseRevision: params.initialRevision,
      patch: params.firstBatch,
      originPushId: `${params.rootOriginPushId}_b0`,
      ...(params.message !== undefined ? { message: params.message } : {}),
      dryRun: true,
    });
    if (checkRes.isErr()) return err(checkRes.error);
    if (!checkRes.value.ok) {
      return ok({ ...checkRes.value, completedBatches: 0, totalBatches: params.totalBatches });
    }
    return ok({
      ok: true,
      dryRun: true,
      baseId: params.baseId,
      baseRevision: params.initialRevision,
      newRevision: checkRes.value.newRevision,
      ...(checkRes.value.commitId ? { commitId: checkRes.value.commitId } : {}),
      rebased: checkRes.value.rebased,
      completedBatches: 0,
      totalBatches: params.totalBatches,
      summary: summarizePatch(params.fullPatch),
    });
  }

  private async commitPushBatchesSequentially(params: {
    readonly config: IVcsWorkspaceConfig;
    readonly baseSchema: IBaseVcsSnapshot;
    readonly batches: readonly IBaseVcsPatch[];
    readonly workingRecordsByTable: ReadonlyMap<string, ReadonlyMap<string, IRecordVcsSnapshot>>;
    readonly tableFieldsById: ReadonlyMap<string, readonly IFieldVcsSnapshot[]>;
    readonly rootOriginPushId: string;
    readonly message?: string;
  }): Promise<
    Result<
      | { readonly ok: false; readonly failureResult: IVcsPushResult }
      | {
          readonly ok: true;
          readonly currentRevision: number;
          readonly currentSchema: IBaseVcsSnapshot;
          readonly committedOriginPushIds: readonly string[];
          readonly anyRebased: boolean;
          readonly lastCommitId?: string;
          readonly lastOriginPushId: string;
          readonly completedBatches: number;
        },
      DomainError
    >
  > {
    const totalBatches = params.batches.length;
    let currentRevision = params.baseSchema.revision;
    let currentSchema = params.baseSchema;
    const committedDeletedIdsByTable = new Map<string, Set<string>>();
    const committedOriginPushIds: string[] = [];
    let anyRebased = false;
    let lastCommitId: string | undefined;
    let lastOriginPushId = params.rootOriginPushId;
    let completedBatches = 0;

    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex += 1) {
      const adjustedBatch = adjustPatchAfterCommittedDeletes(
        params.batches[batchIndex]!,
        committedDeletedIdsByTable,
        params.tableFieldsById
      );
      if (isEmptyPatch(adjustedBatch)) {
        completedBatches += 1;
        continue;
      }

      const batchOriginPushId = `${params.rootOriginPushId}_b${batchIndex}`;
      const batchRes = await this.remoteGateway.pushPatch({
        baseId: params.config.baseId,
        baseRevision: currentRevision,
        patch: adjustedBatch,
        originPushId: batchOriginPushId,
        ...(params.message !== undefined
          ? { message: `${params.message} [${batchIndex + 1}/${totalBatches}]` }
          : {}),
        dryRun: false,
      });
      if (batchRes.isErr()) return err(batchRes.error);
      if (!batchRes.value.ok) {
        return ok({
          ok: false,
          failureResult: {
            ...batchRes.value,
            baseRevision: params.baseSchema.revision,
            completedBatches,
            totalBatches,
          },
        });
      }

      completedBatches += 1;
      anyRebased = anyRebased || batchRes.value.rebased;
      currentRevision = batchRes.value.newRevision;
      lastCommitId = batchRes.value.commitId ?? lastCommitId;
      lastOriginPushId = batchRes.value.originPushId ?? batchOriginPushId;
      committedOriginPushIds.push(lastOriginPushId);
      collectDeletedRecordIdsFromPatch(adjustedBatch, committedDeletedIdsByTable);

      const checkpointRes = await this.checkpointCommittedBatch({
        config: params.config,
        currentSchema,
        patch: adjustedBatch,
        newRevision: currentRevision,
        batchOriginPushId: lastOriginPushId,
        committedOriginPushIds,
        workingRecordsByTable: params.workingRecordsByTable,
      });
      if (checkpointRes.isErr()) return err(checkpointRes.error);
      currentSchema = checkpointRes.value;
    }

    return ok({
      ok: true,
      currentRevision,
      currentSchema,
      committedOriginPushIds,
      anyRebased,
      ...(lastCommitId ? { lastCommitId } : {}),
      lastOriginPushId,
      completedBatches,
    });
  }

  private async executeMultiBatchPush(params: {
    readonly config: IVcsWorkspaceConfig;
    readonly baseSchema: IBaseVcsSnapshot;
    readonly isIndexed: boolean;
    readonly fullPatch: IBaseVcsPatch;
    readonly batches: readonly IBaseVcsPatch[];
    readonly workingRecordsByTable: ReadonlyMap<string, ReadonlyMap<string, IRecordVcsSnapshot>>;
    readonly tableFieldsById: ReadonlyMap<string, readonly IFieldVcsSnapshot[]>;
    readonly message?: string;
    readonly rootOriginPushId: string;
    readonly dryRun: boolean;
  }): Promise<Result<IVcsPushResult, DomainError>> {
    const initialRevision = params.baseSchema.revision;
    const totalBatches = params.batches.length;
    if (params.dryRun) {
      return this.runDryRunMultiBatchPush({
        baseId: params.config.baseId,
        initialRevision,
        firstBatch: params.batches[0]!,
        fullPatch: params.fullPatch,
        rootOriginPushId: params.rootOriginPushId,
        totalBatches,
        message: params.message,
      });
    }

    const loopRes = await this.commitPushBatchesSequentially(params);
    if (loopRes.isErr()) return err(loopRes.error);
    if (!loopRes.value.ok) return ok(loopRes.value.failureResult);

    const committed = loopRes.value;
    const symSyncRes = await this.syncNonCanonicalSymmetricLinksAfterMultiBatch({
      fullPatch: params.fullPatch,
      currentSchema: committed.currentSchema,
    });
    if (symSyncRes.isErr()) return err(symSyncRes.error);

    const finalRes = await this.finalizeCommittedPushState({
      config: params.config,
      initialBaseSchema: params.baseSchema,
      finalRevision: committed.currentRevision,
      lastOriginPushId: committed.lastOriginPushId,
      committedOriginPushIds: committed.committedOriginPushIds,
      rebased: committed.anyRebased,
      isIndexed: params.isIndexed,
    });
    if (finalRes.isErr()) return err(finalRes.error);

    return ok({
      ok: true,
      dryRun: false,
      baseId: params.config.baseId,
      baseRevision: initialRevision,
      newRevision: committed.currentRevision,
      ...(committed.lastCommitId ? { commitId: committed.lastCommitId } : {}),
      originPushId: committed.lastOriginPushId,
      rebased: committed.anyRebased,
      completedBatches: committed.completedBatches,
      totalBatches,
      summary: summarizePatch(params.fullPatch),
    });
  }

  private buildPushLookupMaps(
    baseSchema: IBaseVcsSnapshot,
    workingSnapshot: IBaseVcsSnapshot
  ): {
    readonly tableFieldsById: Map<string, readonly IFieldVcsSnapshot[]>;
    readonly workingRecordsByTable: Map<string, ReadonlyMap<string, IRecordVcsSnapshot>>;
  } {
    const tableFieldsById = new Map<string, readonly IFieldVcsSnapshot[]>();
    for (const t of baseSchema.tables) {
      tableFieldsById.set(t.id, t.fields);
    }
    for (const t of workingSnapshot.tables) {
      tableFieldsById.set(t.id, t.fields);
    }
    const workingRecordsByTable = new Map<string, ReadonlyMap<string, IRecordVcsSnapshot>>();
    for (const t of workingSnapshot.tables) {
      workingRecordsByTable.set(t.id, new Map(t.records.map((r) => [r.id, r])));
    }
    return { tableFieldsById, workingRecordsByTable };
  }

  private async executeSingleBatchPush(params: {
    readonly config: IVcsWorkspaceConfig;
    readonly baseSchema: IBaseVcsSnapshot;
    readonly isIndexed: boolean;
    readonly patch: IBaseVcsPatch;
    readonly originPushId: string;
    readonly message?: string;
    readonly dryRun: boolean;
    readonly workingRecordsByTable: ReadonlyMap<string, ReadonlyMap<string, IRecordVcsSnapshot>>;
  }): Promise<Result<IVcsPushResult, DomainError>> {
    const pushRes = await this.remoteGateway.pushPatch({
      baseId: params.config.baseId,
      baseRevision: params.baseSchema.revision,
      patch: params.patch,
      originPushId: params.originPushId,
      ...(params.message !== undefined ? { message: params.message } : {}),
      dryRun: params.dryRun,
    });
    if (pushRes.isErr()) return err(pushRes.error);

    if (!params.dryRun && pushRes.value.ok) {
      const actualOriginId = pushRes.value.originPushId ?? params.originPushId;
      if (!pushRes.value.rebased) {
        const checkpointRes = await this.checkpointCommittedBatch({
          config: params.config,
          currentSchema: params.baseSchema,
          patch: params.patch,
          newRevision: pushRes.value.newRevision,
          batchOriginPushId: actualOriginId,
          committedOriginPushIds: [actualOriginId],
          workingRecordsByTable: params.workingRecordsByTable,
        });
        if (checkpointRes.isErr()) return err(checkpointRes.error);
      }

      const finalRes = await this.finalizeCommittedPushState({
        config: params.config,
        initialBaseSchema: params.baseSchema,
        finalRevision: pushRes.value.newRevision,
        lastOriginPushId: actualOriginId,
        committedOriginPushIds: [actualOriginId],
        rebased: pushRes.value.rebased,
        isIndexed: params.isIndexed,
      });
      if (finalRes.isErr()) return err(finalRes.error);
    }

    return ok(pushRes.value);
  }

  async execute(input?: IPushBaseVcsInput): Promise<Result<IVcsPushResult, DomainError>> {
    const loadedRes = await loadIndexedWorkspaceDiff(this.stateRepository, this.localEngine, {
      requireWritable: true,
    });
    if (loadedRes.isErr()) return err(loadedRes.error);

    const { config, baseSchema, baseSnapshot, workingSnapshot, conflicts, isIndexed } =
      loadedRes.value;

    if (conflicts.length > 0) {
      return err(
        vcsDomainError.conflict({
          code: 'vcs.unresolved_conflicts',
          message: `Cannot push while ${conflicts.length} unresolved conflict(s) remain`,
        })
      );
    }
    if (config.remoteMode === 'openapi-readonly') {
      return err(
        vcsDomainError.forbidden({
          code: 'vcs.readonly_remote',
          message: 'Cannot push to an openapi-readonly remote',
        })
      );
    }

    const patch = diffSnapshots(baseSnapshot, workingSnapshot, {
      accessScope: baseSnapshot.accessScope,
    });
    const dryRun = Boolean(input?.dryRun);
    if (isEmptyPatch(patch)) {
      return ok({
        ok: true,
        dryRun,
        baseId: config.baseId,
        baseRevision: baseSchema.revision,
        newRevision: baseSchema.revision,
        rebased: false,
        summary: summarizePatch(patch),
      });
    }

    const { tableFieldsById, workingRecordsByTable } = this.buildPushLookupMaps(
      baseSchema,
      workingSnapshot
    );
    const maxBatchSize =
      input?.maxBatchSize !== undefined && input.maxBatchSize > 0
        ? Math.floor(input.maxBatchSize)
        : DEFAULT_MAX_RECORD_OPS_PER_PUSH_BATCH;
    const batches = planPatchBatches(patch, {
      maxRecordOpsPerBatch: maxBatchSize,
      tableFieldsById,
    });
    const originPushId = input?.originPushId ?? `vcsp_${randomUUID().replace(/-/g, '')}`;

    if (batches.length > 1) {
      return this.executeMultiBatchPush({
        config,
        baseSchema,
        isIndexed,
        fullPatch: patch,
        batches,
        workingRecordsByTable,
        tableFieldsById,
        message: input?.message,
        rootOriginPushId: originPushId,
        dryRun,
      });
    }

    return this.executeSingleBatchPush({
      config,
      baseSchema,
      isIndexed,
      patch,
      originPushId,
      message: input?.message,
      dryRun,
      workingRecordsByTable,
    });
  }
}
