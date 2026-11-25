import type { DomainError } from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { diffSnapshots, isEmptyPatch } from '../../domain/diffSnapshots';
import { vcsDomainError } from '../../domain/errors';
import { canonicalizeSnapshot } from '../../domain/fieldClassification';
import { threeWayMerge } from '../../domain/threeWayMerge';
import type {
  IBaseVcsSnapshot,
  IRecordVcsSnapshot,
  ITableVcsSnapshot,
  IVcsConflict,
  IVcsIncrementalChanges,
  VcsMultiValueStrategy,
} from '../../domain/types';
import {
  v2VcsClientTokens,
  type IVcsBaseRecordTableMutation,
  type IVcsLocalEnginePort,
  type IVcsRemoteGateway,
  type IVcsStateRepository,
  type IVcsWorkspaceConfig,
} from '../../ports';
import {
  EAGER_RETURN_SNAPSHOT_RECORD_LIMIT,
  loadRemoteAndLocalDiffState,
  runWithEngineSession,
} from './workspaceHelpers';

export interface IPullBaseVcsInput {
  readonly multiValueStrategy?: VcsMultiValueStrategy;
  readonly includeSnapshot?: boolean;
}

export interface IPullBaseVcsOutput {
  readonly fromRevision: number;
  readonly toRevision: number;
  readonly autoMergedCount: number;
  readonly conflicts: readonly IVcsConflict[];
  readonly workingSnapshot: IBaseVcsSnapshot;
  readonly baseSnapshot: IBaseVcsSnapshot;
}

function collectKnownOriginPushIds(config: IVcsWorkspaceConfig): Set<string> {
  const known = new Set<string>();
  if (config.lastOriginPushId) {
    known.add(config.lastOriginPushId);
  }
  for (const id of config.lastOriginPushIds ?? []) {
    known.add(id);
  }
  return known;
}

@injectable()
export class PullBaseVcsService {
  constructor(
    @inject(v2VcsClientTokens.remoteGateway)
    private readonly remoteGateway: IVcsRemoteGateway,
    @inject(v2VcsClientTokens.localEngine)
    private readonly localEngine: IVcsLocalEnginePort,
    @inject(v2VcsClientTokens.stateRepository)
    private readonly stateRepository: IVcsStateRepository
  ) {}

  private mergePullState(params: {
    config: IVcsWorkspaceConfig;
    baseSnapshot: IBaseVcsSnapshot;
    workingSnapshot: IBaseVcsSnapshot;
    theirsSnapshot: IBaseVcsSnapshot;
    originPushIds?: readonly string[];
    multiValueStrategy?: VcsMultiValueStrategy;
  }) {
    const localHasEditsSinceBase = !isEmptyPatch(
      diffSnapshots(params.baseSnapshot, params.workingSnapshot, {
        accessScope: params.baseSnapshot.accessScope,
      })
    );
    const knownOriginIds = collectKnownOriginPushIds(params.config);
    const allRemoteFromOwnPush = Boolean(
      knownOriginIds.size > 0 &&
      params.originPushIds &&
      params.originPushIds.length > 0 &&
      params.originPushIds.every((id) => knownOriginIds.has(id))
    );
    if (allRemoteFromOwnPush && !localHasEditsSinceBase) {
      return {
        mergedSnapshot: params.theirsSnapshot,
        conflicts: [] as IVcsConflict[],
        autoMergedCount: 0,
        localHasEditsSinceBase,
        allRemoteFromOwnPush,
      };
    }
    const merged = threeWayMerge({
      base: params.baseSnapshot,
      ours: params.workingSnapshot,
      theirs: params.theirsSnapshot,
      options: {
        multiValueStrategy:
          params.multiValueStrategy ?? params.config.multiValueStrategy ?? 'strict',
      },
    });
    return {
      ...merged,
      localHasEditsSinceBase,
      allRemoteFromOwnPush,
    };
  }

  private async persistPullSnapshots(params: {
    config: IVcsWorkspaceConfig;
    baseSnapshot: IBaseVcsSnapshot;
    workingSnapshot: IBaseVcsSnapshot;
    theirsSnapshot: IBaseVcsSnapshot;
    mergedSnapshot: IBaseVcsSnapshot;
    conflicts: readonly IVcsConflict[];
    nextCursor?: string;
  }): Promise<Result<void, DomainError>> {
    const nextConfig: IVcsWorkspaceConfig = {
      ...params.config,
      baseName: params.theirsSnapshot.baseName,
      ...(params.nextCursor !== undefined ? { pullCursor: params.nextCursor } : {}),
      lastPulledAt: new Date().toISOString(),
    };
    const writeCfg = await this.stateRepository.writeConfig(nextConfig);
    if (writeCfg.isErr()) return err(writeCfg.error);

    const persistedBaseSnapshot =
      params.nextCursor !== undefined
        ? { ...params.theirsSnapshot, cursor: params.nextCursor }
        : params.theirsSnapshot;
    const writeBase = await this.stateRepository.writeBaseSnapshot(persistedBaseSnapshot);
    if (writeBase.isErr()) return err(writeBase.error);

    const writeConflicts = await this.stateRepository.writeConflicts(params.conflicts);
    if (writeConflicts.isErr()) return err(writeConflicts.error);

    const mergeState =
      params.conflicts.length > 0
        ? {
            baseSnapshot: params.baseSnapshot,
            oursSnapshot: params.workingSnapshot,
            theirsSnapshot: params.theirsSnapshot,
            workingSnapshot: params.mergedSnapshot,
            conflicts: params.conflicts,
          }
        : null;
    return this.stateRepository.writeMergeState(mergeState);
  }

  private async hydrateAndFinalizePull(params: {
    readonly theirsSnapshot: IBaseVcsSnapshot;
    readonly mergedSnapshot: IBaseVcsSnapshot;
    readonly conflicts: readonly IVcsConflict[];
    readonly localHasEditsSinceBase: boolean;
    readonly nextCursor?: string;
  }): Promise<
    Result<
      { readonly workingSnapshot: IBaseVcsSnapshot; readonly baseSnapshot: IBaseVcsSnapshot },
      DomainError
    >
  > {
    let finalWorkingSnapshot = params.mergedSnapshot;
    let persistedBaseSnapshot = params.theirsSnapshot;
    const hydrateRes = await runWithEngineSession(this.localEngine, async (engine) => {
      const res = await engine.hydrateSnapshot(params.mergedSnapshot);
      if (res.isErr()) return err(res.error);
      if (params.conflicts.length === 0 && !params.localHasEditsSinceBase) {
        await engine.markWorkingClean?.(params.theirsSnapshot.baseId);
      } else {
        await engine.ensureWorkingTrackingTriggers?.(params.theirsSnapshot.baseId);
      }
      return res;
    });
    if (hydrateRes.isErr()) {
      return params.conflicts.length === 0
        ? err(hydrateRes.error)
        : ok({ workingSnapshot: finalWorkingSnapshot, baseSnapshot: persistedBaseSnapshot });
    }

    if (hydrateRes.value.snapshot) {
      finalWorkingSnapshot = canonicalizeSnapshot(
        {
          ...hydrateRes.value.snapshot,
          revision: params.theirsSnapshot.revision,
          ...(params.nextCursor !== undefined ? { cursor: params.nextCursor } : {}),
          ...(params.theirsSnapshot.accessScope
            ? { accessScope: params.theirsSnapshot.accessScope }
            : {}),
        },
        { preserveComputed: true }
      );
      if (params.conflicts.length === 0 && !params.localHasEditsSinceBase) {
        const writeBaseRes = await this.stateRepository.writeBaseSnapshot(finalWorkingSnapshot);
        if (writeBaseRes.isErr()) return err(writeBaseRes.error);
        persistedBaseSnapshot = finalWorkingSnapshot;
      }
    }

    return ok({
      workingSnapshot: finalWorkingSnapshot,
      baseSnapshot: persistedBaseSnapshot,
    });
  }

  private async capturePostPullDeltaByTable(
    engine: IVcsLocalEnginePort,
    params: {
      readonly baseId: string;
      readonly baseName: string;
      readonly revision: number;
      readonly isCleanAfterPull: boolean;
    }
  ): Promise<Map<string, Map<string, IRecordVcsSnapshot>>> {
    const postDeltaByTable = new Map<string, Map<string, IRecordVcsSnapshot>>();
    if (!params.isCleanAfterPull || !engine.captureWorkingDelta) {
      return postDeltaByTable;
    }
    const postDeltaRes = await engine.captureWorkingDelta(params.baseId, {
      baseName: params.baseName,
      revision: params.revision,
    });
    if (postDeltaRes.isOk()) {
      for (const [tableId, td] of postDeltaRes.value.tableDeltas.entries()) {
        postDeltaByTable.set(tableId, new Map(td.upsertedRecords.map((r) => [r.id, r])));
      }
    }
    return postDeltaByTable;
  }

  private overlayPostComputedRecords(
    records: readonly IRecordVcsSnapshot[],
    postMap?: Map<string, IRecordVcsSnapshot>
  ): IRecordVcsSnapshot[] {
    return records.map((r) => {
      const postRec = postMap?.get(r.id);
      return postRec
        ? { ...postRec, ...(r.version !== undefined ? { version: r.version } : {}) }
        : r;
    });
  }

  private buildIncrementalMutationLists(params: {
    readonly baseSchema: IBaseVcsSnapshot;
    readonly theirsSnapshot: IBaseVcsSnapshot;
    readonly remoteChanges: IVcsIncrementalChanges;
    readonly postDeltaByTable: Map<string, Map<string, IRecordVcsSnapshot>>;
    readonly isCleanAfterPull: boolean;
  }): {
    readonly deletedTableIds: string[];
    readonly tablesAdded: ITableVcsSnapshot[];
    readonly tablesSchemaUpdated: ITableVcsSnapshot[];
    readonly recordChanges: IVcsBaseRecordTableMutation[];
  } {
    const existingBaseTableIds = new Set(params.baseSchema.tables.map((t) => t.id));
    const deletedTableIds = [...params.remoteChanges.deletedTableIds];
    const deletedSet = new Set(deletedTableIds);
    const tablesAdded: ITableVcsSnapshot[] = [];
    const tablesSchemaUpdated: ITableVcsSnapshot[] = [];
    const addedTableIds = new Set<string>();
    const theirsTableById = new Map(params.theirsSnapshot.tables.map((t) => [t.id, t]));

    for (const upsertedTable of params.remoteChanges.upsertedTables) {
      if (deletedSet.has(upsertedTable.id)) continue;
      if (!existingBaseTableIds.has(upsertedTable.id)) {
        addedTableIds.add(upsertedTable.id);
        const mergedTable = theirsTableById.get(upsertedTable.id) ?? upsertedTable;
        tablesAdded.push({
          ...mergedTable,
          records: this.overlayPostComputedRecords(
            mergedTable.records,
            params.postDeltaByTable.get(upsertedTable.id)
          ),
        });
      } else {
        tablesSchemaUpdated.push({ ...upsertedTable, records: [] });
      }
    }

    const recordChanges: IVcsBaseRecordTableMutation[] = [];
    const remoteUpsertIdsByTable = new Map<string, Set<string>>();
    for (const delta of params.remoteChanges.recordDeltas) {
      if (addedTableIds.has(delta.tableId) || deletedSet.has(delta.tableId)) continue;
      remoteUpsertIdsByTable.set(delta.tableId, new Set(delta.upserts.map((r) => r.id)));
      const upserts = this.overlayPostComputedRecords(
        delta.upserts,
        params.postDeltaByTable.get(delta.tableId)
      );
      if (upserts.length > 0 || delta.deletes.length > 0) {
        recordChanges.push({ tableId: delta.tableId, upserts, deleteIds: delta.deletes });
      }
    }

    if (params.isCleanAfterPull) {
      this.appendUntouchedPostComputedMutations(
        params.postDeltaByTable,
        addedTableIds,
        deletedSet,
        remoteUpsertIdsByTable,
        recordChanges
      );
    }

    return { deletedTableIds, tablesAdded, tablesSchemaUpdated, recordChanges };
  }

  private appendUntouchedPostComputedMutations(
    postDeltaByTable: Map<string, Map<string, IRecordVcsSnapshot>>,
    addedTableIds: Set<string>,
    deletedSet: Set<string>,
    remoteUpsertIdsByTable: Map<string, Set<string>>,
    recordChanges: IVcsBaseRecordTableMutation[]
  ): void {
    for (const [tableId, postMap] of postDeltaByTable.entries()) {
      if (addedTableIds.has(tableId) || deletedSet.has(tableId)) continue;
      const remoteUpsertIds = remoteUpsertIdsByTable.get(tableId);
      const extraUpserts: IRecordVcsSnapshot[] = [];
      for (const [recId, rec] of postMap.entries()) {
        if (!remoteUpsertIds?.has(recId)) {
          extraUpserts.push(rec);
        }
      }
      if (extraUpserts.length > 0) {
        recordChanges.push({ tableId, upserts: extraUpserts });
      }
    }
  }

  private async persistIncrementalStateAndFinalizeSnapshots(
    engine: IVcsLocalEnginePort,
    params: {
      readonly config: IVcsWorkspaceConfig;
      readonly baseSnapshot: IBaseVcsSnapshot;
      readonly workingSnapshot: IBaseVcsSnapshot;
      readonly theirsSnapshot: IBaseVcsSnapshot;
      readonly mergedSnapshot: IBaseVcsSnapshot;
      readonly conflicts: readonly IVcsConflict[];
      readonly totalBaseRecords: number;
      readonly nextCursor?: string;
      readonly includeSnapshot?: boolean;
    },
    mutations: {
      readonly deletedTableIds: string[];
      readonly tablesAdded: ITableVcsSnapshot[];
      readonly tablesSchemaUpdated: ITableVcsSnapshot[];
      readonly recordChanges: IVcsBaseRecordTableMutation[];
    },
    isCleanAfterPull: boolean
  ): Promise<
    Result<
      { readonly workingSnapshot: IBaseVcsSnapshot; readonly baseSnapshot: IBaseVcsSnapshot },
      DomainError
    >
  > {
    const cfgRes = await this.stateRepository.writeConfig({
      ...params.config,
      baseName: params.theirsSnapshot.baseName,
      ...(params.nextCursor !== undefined ? { pullCursor: params.nextCursor } : {}),
      lastPulledAt: new Date().toISOString(),
    });
    if (cfgRes.isErr()) return err(cfgRes.error);

    const mutRes = await this.stateRepository.applyBaseStateMutations!({
      revision: params.theirsSnapshot.revision,
      ...(params.nextCursor !== undefined ? { cursor: params.nextCursor } : {}),
      baseName: params.theirsSnapshot.baseName,
      ...(params.theirsSnapshot.accessScope
        ? { accessScope: params.theirsSnapshot.accessScope }
        : {}),
      tablesDeleted: mutations.deletedTableIds,
      tablesAdded: mutations.tablesAdded,
      tablesSchemaUpdated: mutations.tablesSchemaUpdated,
      recordChanges: mutations.recordChanges,
    });
    if (mutRes.isErr()) return err(mutRes.error);

    const confRes = await this.stateRepository.writeConflicts(params.conflicts);
    if (confRes.isErr()) return err(confRes.error);

    const mergeState =
      params.conflicts.length > 0
        ? {
            baseSnapshot: params.baseSnapshot,
            oursSnapshot: params.workingSnapshot,
            theirsSnapshot: params.theirsSnapshot,
            workingSnapshot: params.mergedSnapshot,
            conflicts: params.conflicts,
          }
        : null;
    const msRes = await this.stateRepository.writeMergeState(mergeState);
    if (msRes.isErr()) return err(msRes.error);

    const trackRes = isCleanAfterPull
      ? await engine.markWorkingClean?.(params.config.baseId)
      : await engine.ensureWorkingTrackingTriggers?.(params.config.baseId);
    if (trackRes?.isErr()) return err(trackRes.error);

    return this.buildIncrementalPullOutputSnapshots(engine, params, isCleanAfterPull);
  }

  private async buildIncrementalPullOutputSnapshots(
    engine: IVcsLocalEnginePort,
    params: {
      readonly config: IVcsWorkspaceConfig;
      readonly theirsSnapshot: IBaseVcsSnapshot;
      readonly mergedSnapshot: IBaseVcsSnapshot;
      readonly totalBaseRecords: number;
      readonly nextCursor?: string;
      readonly includeSnapshot?: boolean;
    },
    isCleanAfterPull: boolean
  ): Promise<
    Result<
      { readonly workingSnapshot: IBaseVcsSnapshot; readonly baseSnapshot: IBaseVcsSnapshot },
      DomainError
    >
  > {
    const baseWorking = canonicalizeSnapshot(
      {
        ...params.mergedSnapshot,
        revision: params.theirsSnapshot.revision,
        ...(params.nextCursor !== undefined ? { cursor: params.nextCursor } : {}),
      },
      { preserveComputed: true }
    );
    const shouldCaptureFull =
      params.includeSnapshot === true ||
      (params.includeSnapshot !== false &&
        params.totalBaseRecords <= EAGER_RETURN_SNAPSHOT_RECORD_LIMIT);

    if (!shouldCaptureFull) {
      return ok({ workingSnapshot: baseWorking, baseSnapshot: params.theirsSnapshot });
    }

    const capRes = await engine.captureSnapshot(params.config.baseId, {
      baseName: params.theirsSnapshot.baseName,
      revision: params.theirsSnapshot.revision,
    });
    if (capRes.isErr()) return err(capRes.error);

    const captured = canonicalizeSnapshot(
      {
        ...capRes.value,
        revision: params.theirsSnapshot.revision,
        ...(params.nextCursor !== undefined ? { cursor: params.nextCursor } : {}),
        ...(params.theirsSnapshot.accessScope
          ? { accessScope: params.theirsSnapshot.accessScope }
          : {}),
      },
      { preserveComputed: true }
    );
    return ok({
      workingSnapshot: captured,
      baseSnapshot: isCleanAfterPull ? captured : params.theirsSnapshot,
    });
  }

  private async applyIndexedIncrementalPull(params: {
    readonly config: IVcsWorkspaceConfig;
    readonly baseSchema: IBaseVcsSnapshot;
    readonly totalBaseRecords: number;
    readonly baseSnapshot: IBaseVcsSnapshot;
    readonly workingSnapshot: IBaseVcsSnapshot;
    readonly theirsSnapshot: IBaseVcsSnapshot;
    readonly mergedSnapshot: IBaseVcsSnapshot;
    readonly remoteChanges: IVcsIncrementalChanges;
    readonly conflicts: readonly IVcsConflict[];
    readonly localHasEditsSinceBase: boolean;
    readonly allRemoteFromOwnPush: boolean;
    readonly nextCursor?: string;
    readonly includeSnapshot?: boolean;
  }): Promise<
    Result<
      { readonly workingSnapshot: IBaseVcsSnapshot; readonly baseSnapshot: IBaseVcsSnapshot },
      DomainError
    >
  > {
    const engineDeltaPatch = diffSnapshots(params.workingSnapshot, params.mergedSnapshot);
    const shouldSkipApply =
      isEmptyPatch(engineDeltaPatch) ||
      (params.allRemoteFromOwnPush && !params.localHasEditsSinceBase);
    const isCleanAfterPull = params.conflicts.length === 0 && !params.localHasEditsSinceBase;

    return runWithEngineSession(this.localEngine, async (engine) => {
      if (!shouldSkipApply) {
        const applyRes = await engine.applyPatch(params.config.baseId, engineDeltaPatch, {
          skipCaptureSnapshot: true,
        });
        if (applyRes.isErr() && params.conflicts.length === 0) {
          return err(applyRes.error);
        }
      }

      const postDeltaByTable = await this.capturePostPullDeltaByTable(engine, {
        baseId: params.config.baseId,
        baseName: params.theirsSnapshot.baseName,
        revision: params.theirsSnapshot.revision,
        isCleanAfterPull,
      });

      const mutations = this.buildIncrementalMutationLists({
        baseSchema: params.baseSchema,
        theirsSnapshot: params.theirsSnapshot,
        remoteChanges: params.remoteChanges,
        postDeltaByTable,
        isCleanAfterPull,
      });

      return this.persistIncrementalStateAndFinalizeSnapshots(
        engine,
        params,
        mutations,
        isCleanAfterPull
      );
    });
  }

  async execute(input?: IPullBaseVcsInput): Promise<Result<IPullBaseVcsOutput, DomainError>> {
    const stateRes = await loadRemoteAndLocalDiffState(
      this.remoteGateway,
      this.stateRepository,
      this.localEngine,
      { requireWritable: true, rejectIfUnresolvedConflicts: true }
    );
    if (stateRes.isErr()) return err(stateRes.error);

    const { loaded, theirsSnapshot, changes: remoteChanges, isIncremental } = stateRes.value;
    const { config, baseSchema, totalBaseRecords, baseSnapshot, workingSnapshot } = loaded;

    if (loaded.conflicts.length > 0) {
      return err(
        vcsDomainError.conflict({
          code: 'vcs.unresolved_conflicts',
          message: `Cannot pull while ${loaded.conflicts.length} unresolved conflict(s) remain`,
        })
      );
    }

    const nextCursor = remoteChanges?.nextCursor ?? theirsSnapshot.cursor ?? config.pullCursor;
    const mergeResult = this.mergePullState({
      config,
      baseSnapshot,
      workingSnapshot,
      theirsSnapshot,
      originPushIds: remoteChanges?.originPushIds,
      multiValueStrategy: input?.multiValueStrategy,
    });

    if (
      loaded.isIndexed &&
      isIncremental &&
      remoteChanges &&
      this.stateRepository.applyBaseStateMutations
    ) {
      const indexedRes = await this.applyIndexedIncrementalPull({
        config,
        baseSchema,
        totalBaseRecords,
        baseSnapshot,
        workingSnapshot,
        theirsSnapshot,
        mergedSnapshot: mergeResult.mergedSnapshot,
        remoteChanges,
        conflicts: mergeResult.conflicts,
        localHasEditsSinceBase: mergeResult.localHasEditsSinceBase,
        allRemoteFromOwnPush: mergeResult.allRemoteFromOwnPush,
        nextCursor,
        includeSnapshot: input?.includeSnapshot,
      });
      if (indexedRes.isErr()) return err(indexedRes.error);

      return ok({
        fromRevision: baseSnapshot.revision,
        toRevision: theirsSnapshot.revision,
        autoMergedCount: mergeResult.autoMergedCount,
        conflicts: mergeResult.conflicts,
        workingSnapshot: indexedRes.value.workingSnapshot,
        baseSnapshot: indexedRes.value.baseSnapshot,
      });
    }

    const persistRes = await this.persistPullSnapshots({
      config,
      baseSnapshot,
      workingSnapshot,
      theirsSnapshot,
      mergedSnapshot: mergeResult.mergedSnapshot,
      conflicts: mergeResult.conflicts,
      nextCursor,
    });
    if (persistRes.isErr()) return err(persistRes.error);

    const finalizedRes = await this.hydrateAndFinalizePull({
      theirsSnapshot,
      mergedSnapshot: mergeResult.mergedSnapshot,
      conflicts: mergeResult.conflicts,
      localHasEditsSinceBase: mergeResult.localHasEditsSinceBase,
      nextCursor,
    });
    if (finalizedRes.isErr()) return err(finalizedRes.error);

    return ok({
      fromRevision: baseSnapshot.revision,
      toRevision: theirsSnapshot.revision,
      autoMergedCount: mergeResult.autoMergedCount,
      conflicts: mergeResult.conflicts,
      workingSnapshot: finalizedRes.value.workingSnapshot,
      baseSnapshot: finalizedRes.value.baseSnapshot,
    });
  }
}
