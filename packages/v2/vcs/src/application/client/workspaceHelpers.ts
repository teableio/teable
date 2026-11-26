import type { DomainError } from '@teable/v2-core';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { applyIncrementalChanges } from '../../domain/applyIncrementalChanges';
import { readonlyCheckoutError, vcsDomainError } from '../../domain/errors';
import {
  canonicalizeRecord,
  canonicalizeSnapshot,
  canonicalizeTable,
  deepEqualVcs,
  isStoredVcsField,
} from '../../domain/fieldClassification';
import type {
  IBaseVcsSnapshot,
  IRecordVcsSnapshot,
  ITableVcsSnapshot,
  IVcsConflict,
  IVcsIncrementalChanges,
  IVcsTableRecordDelta,
  IVcsWorkingDelta,
} from '../../domain/types';
import type {
  ICloneSnapshotOptions,
  IVcsLocalEnginePort,
  IVcsRemoteGateway,
  IVcsStateRepository,
  IVcsWorkspaceConfig,
} from '../../ports';

export const EAGER_RETURN_SNAPSHOT_RECORD_LIMIT = 100;

export interface LoadedVcsWorkspace {
  config: IVcsWorkspaceConfig;
  baseSnapshot: IBaseVcsSnapshot;
  workingSnapshot: IBaseVcsSnapshot;
  conflicts: readonly IVcsConflict[];
}

export interface IndexedWorkspaceDiff {
  readonly isIndexed: boolean;
  readonly config: IVcsWorkspaceConfig;
  readonly baseSchema: IBaseVcsSnapshot;
  readonly totalBaseRecords: number;
  readonly tableRecordCounts: Readonly<Record<string, number>>;
  readonly baseSnapshot: IBaseVcsSnapshot;
  readonly workingSnapshot: IBaseVcsSnapshot;
  readonly workingDelta?: IVcsWorkingDelta;
  readonly conflicts: readonly IVcsConflict[];
}

export interface LoadIndexedWorkspaceDiffOptions {
  readonly requireWritable?: boolean;
  readonly includeComputedSchemaFullTable?: boolean;
  readonly extraTouchedRecordIdsByTable?: ReadonlyMap<string, ReadonlySet<string>>;
  readonly forceFullRecordTables?: ReadonlySet<string>;
}

export interface RemoteIncrementalState {
  readonly isIncremental: boolean;
  readonly changes?: IVcsIncrementalChanges;
  readonly fullSnapshot?: IBaseVcsSnapshot;
  readonly touchedRecordIdsByTable: ReadonlyMap<string, ReadonlySet<string>>;
  readonly deletedTableIds: ReadonlySet<string>;
}

export async function runWithEngineSession<T>(
  localEngine: IVcsLocalEnginePort,
  fn: (engine: IVcsLocalEnginePort) => Promise<Result<T, DomainError>>
): Promise<Result<T, DomainError>> {
  if (localEngine.withSession) {
    return localEngine.withSession(fn);
  }
  return fn(localEngine);
}

export async function captureFullTableRecordsFromEngine(
  localEngine: IVcsLocalEnginePort,
  baseId: string,
  tableId: string
): Promise<Result<IRecordVcsSnapshot[], DomainError>> {
  if (localEngine.captureTableRecordsChunk) {
    const records: IRecordVcsSnapshot[] = [];
    let cursor: string | undefined;
    for (;;) {
      const chunkRes = await localEngine.captureTableRecordsChunk(baseId, tableId, {
        ...(cursor ? { cursor } : {}),
        limit: 500,
      });
      if (chunkRes.isErr()) return err(chunkRes.error);
      records.push(...chunkRes.value.records);
      if (!chunkRes.value.hasMore || !chunkRes.value.nextCursor) {
        break;
      }
      cursor = chunkRes.value.nextCursor;
    }
    return ok(records);
  }

  const snapRes = await localEngine.captureSnapshot(baseId);
  if (snapRes.isErr()) return err(snapRes.error);
  const table = snapRes.value.tables.find((t) => t.id === tableId);
  return ok(table ? [...table.records] : []);
}

export function buildEmptyBaseSnapshotFromConfig(
  config: IVcsWorkspaceConfig,
  revision = 0
): IBaseVcsSnapshot {
  return {
    formatVersion: 1,
    baseId: config.baseId,
    baseName: config.baseName,
    revision,
    ...(config.pullCursor !== undefined ? { cursor: config.pullCursor } : {}),
    capturedAt: new Date().toISOString(),
    tables: [],
  };
}

export async function readRequiredBaseSnapshot(
  stateRepository: IVcsStateRepository
): Promise<Result<IBaseVcsSnapshot, DomainError>> {
  const snapshot = await stateRepository.readBaseSnapshot();
  if (snapshot.isErr()) return err(snapshot.error);
  if (snapshot.value) return ok(snapshot.value);
  return err(
    vcsDomainError.notFound({
      code: 'vcs.missing_base_snapshot',
      message: 'VCS base snapshot is missing',
    })
  );
}

export async function loadVcsWorkspace(
  stateRepository: IVcsStateRepository,
  localEngine: IVcsLocalEnginePort
): Promise<Result<LoadedVcsWorkspace, DomainError>> {
  const configRes = await stateRepository.readConfig();
  if (configRes.isErr()) return err(configRes.error);
  if (!configRes.value) {
    return err(
      vcsDomainError.notFound({
        code: 'vcs.not_initialized',
        message: 'VCS workspace is not initialized in this directory',
      })
    );
  }

  const baseRes = await readRequiredBaseSnapshot(stateRepository);
  if (baseRes.isErr()) return err(baseRes.error);

  const config = configRes.value;
  const baseSnapshot = baseRes.value;
  const conflictsRes = await stateRepository.readConflicts();
  if (conflictsRes.isErr()) return err(conflictsRes.error);
  // A historical working copy is the immutable checkpoint. PGlite is its query index.
  if (config.readOnly) {
    return ok({
      config,
      baseSnapshot,
      workingSnapshot: baseSnapshot,
      conflicts: conflictsRes.value,
    });
  }

  const workingRes = await localEngine.captureSnapshot(config.baseId, {
    baseName: config.baseName,
    revision: baseSnapshot.revision,
  });
  if (workingRes.isErr()) return err(workingRes.error);

  const workingSnapshot: IBaseVcsSnapshot = baseSnapshot.accessScope
    ? { ...workingRes.value, accessScope: baseSnapshot.accessScope }
    : workingRes.value;

  return ok({
    config,
    baseSnapshot,
    workingSnapshot,
    conflicts: conflictsRes.value,
  });
}

/** Use target storage defaults when comparing stable record IDs in a Builder working copy. */
export function alignPromotionWorkingSnapshot(
  working: IBaseVcsSnapshot,
  baseline: IBaseVcsSnapshot
): IBaseVcsSnapshot {
  const baselineTables = new Map(baseline.tables.map((table) => [table.id, table]));
  return {
    ...working,
    tables: working.tables.map((table) => {
      const base = baselineTables.get(table.id);
      if (!base?.records.length) return table;
      const baselineRecords = new Map(base.records.map((record) => [record.id, record]));
      return {
        ...table,
        records: table.records.map((record) => {
          const checkpoint = baselineRecords.get(record.id);
          if (checkpoint?.autoNumber === undefined) return record;
          // Restoring an explicit order may materialize an entire view's order column.
          // A value equal to the checkpoint's implicit default still represents no edit.
          const { orders } = record;
          let projectedOrders: Record<string, number> | undefined;
          if (orders) {
            for (const viewId of Object.keys(orders)) {
              if (
                checkpoint.orders?.[viewId] === undefined &&
                orders[viewId] === checkpoint.autoNumber
              ) {
                projectedOrders ??= { ...orders };
                delete projectedOrders[viewId];
              }
            }
          }
          if (checkpoint.autoNumber === record.autoNumber && projectedOrders === undefined) {
            return record;
          }
          return {
            ...record,
            autoNumber: checkpoint.autoNumber,
            orders:
              projectedOrders && !Object.keys(projectedOrders).length
                ? undefined
                : (projectedOrders ?? orders),
          };
        }),
      };
    }),
  };
}

function hasComputedFieldSchemaDifference(
  beforeTable: ITableVcsSnapshot,
  afterTable: ITableVcsSnapshot
): boolean {
  const beforeMap = new Map(beforeTable.fields.map((f) => [f.id, f]));
  for (const afterField of afterTable.fields) {
    if (isStoredVcsField(afterField)) continue;
    const beforeField = beforeMap.get(afterField.id);
    if (!beforeField || !deepEqualVcs(beforeField, afterField)) {
      return true;
    }
  }
  return false;
}

function addComputedSchemaDiffFullTables(
  baseTableMap: ReadonlyMap<string, ITableVcsSnapshot>,
  workTableMap: ReadonlyMap<string, ITableVcsSnapshot>,
  fullBaseTableIds: Set<string>,
  fullWorkTableIds: Set<string>
): void {
  for (const [tableId, workTable] of workTableMap.entries()) {
    const baseTable = baseTableMap.get(tableId);
    if (baseTable && hasComputedFieldSchemaDifference(baseTable, workTable)) {
      fullBaseTableIds.add(tableId);
      fullWorkTableIds.add(tableId);
    }
  }
}

function computeFullRecordTableSets(
  baseSchema: IBaseVcsSnapshot,
  workSchemaRaw: IBaseVcsSnapshot,
  options?: LoadIndexedWorkspaceDiffOptions
): {
  readonly fullBaseTableIds: Set<string>;
  readonly fullWorkTableIds: Set<string>;
} {
  const baseTableMap = new Map(baseSchema.tables.map((t) => [t.id, t]));
  const workTableMap = new Map(workSchemaRaw.tables.map((t) => [t.id, t]));
  const fullBaseTableIds = new Set<string>();
  const fullWorkTableIds = new Set<string>();

  for (const tableId of baseTableMap.keys()) {
    if (!workTableMap.has(tableId)) fullBaseTableIds.add(tableId);
  }
  for (const tableId of workTableMap.keys()) {
    if (!baseTableMap.has(tableId)) fullWorkTableIds.add(tableId);
  }
  for (const tableId of options?.forceFullRecordTables ?? []) {
    if (baseTableMap.has(tableId)) fullBaseTableIds.add(tableId);
    if (workTableMap.has(tableId)) fullWorkTableIds.add(tableId);
  }
  if (options?.includeComputedSchemaFullTable) {
    addComputedSchemaDiffFullTables(baseTableMap, workTableMap, fullBaseTableIds, fullWorkTableIds);
  }
  return { fullBaseTableIds, fullWorkTableIds };
}

async function loadOptionalFullBaseTables(
  stateRepository: IVcsStateRepository,
  fullBaseTableIds: ReadonlySet<string>
): Promise<Result<Map<string, ITableVcsSnapshot> | undefined, DomainError>> {
  if (fullBaseTableIds.size === 0) return ok(undefined);
  const fullBaseRes = await stateRepository.readBaseSnapshot();
  if (fullBaseRes.isErr()) return err(fullBaseRes.error);
  if (!fullBaseRes.value) return ok(undefined);
  return ok(new Map(fullBaseRes.value.tables.map((t) => [t.id, t])));
}

async function buildScopedBaseTables(params: {
  readonly stateRepository: IVcsStateRepository;
  readonly baseSchema: IBaseVcsSnapshot;
  readonly workingDelta: IVcsWorkingDelta;
  readonly fullBaseTableIds: ReadonlySet<string>;
  readonly extraTouchedRecordIdsByTable?: ReadonlyMap<string, ReadonlySet<string>>;
}): Promise<Result<ITableVcsSnapshot[], DomainError>> {
  const fullMapRes = await loadOptionalFullBaseTables(
    params.stateRepository,
    params.fullBaseTableIds
  );
  if (fullMapRes.isErr()) return err(fullMapRes.error);
  const fullBaseTableMap = fullMapRes.value;

  const scopedBaseTables: ITableVcsSnapshot[] = [];
  for (const baseTable of params.baseSchema.tables) {
    if (params.fullBaseTableIds.has(baseTable.id)) {
      scopedBaseTables.push(fullBaseTableMap?.get(baseTable.id) ?? baseTable);
      continue;
    }
    const neededIds = new Set<string>([
      ...(params.workingDelta.tableDeltas.get(baseTable.id)?.dirtyRecordIds ?? []),
      ...(params.extraTouchedRecordIdsByTable?.get(baseTable.id) ?? []),
    ]);
    if (neededIds.size === 0) {
      scopedBaseTables.push({ ...baseTable, records: [] });
      continue;
    }
    const recMapRes = await params.stateRepository.readBaseRecordsByIds!(
      baseTable.id,
      Array.from(neededIds)
    );
    if (recMapRes.isErr()) return err(recMapRes.error);
    const records = Array.from(recMapRes.value.values()).map((r) =>
      canonicalizeRecord(r, baseTable.fields, { preserveComputed: true })
    );
    scopedBaseTables.push(canonicalizeTable({ ...baseTable, records }, { preserveComputed: true }));
  }
  return ok(scopedBaseTables);
}

function fillUntouchedRemoteIdsFromBase(params: {
  readonly workTable: ITableVcsSnapshot;
  readonly dirtyIdSet: ReadonlySet<string>;
  readonly deletedIdSet: ReadonlySet<string>;
  readonly recMap: Map<string, IRecordVcsSnapshot>;
  readonly baseRecords: readonly IRecordVcsSnapshot[];
  readonly extraIds?: ReadonlySet<string>;
}): void {
  if (!params.extraIds || params.extraIds.size === 0) return;
  const baseRecById = new Map(params.baseRecords.map((r) => [r.id, r]));
  for (const extraId of params.extraIds) {
    if (
      params.dirtyIdSet.has(extraId) ||
      params.deletedIdSet.has(extraId) ||
      params.recMap.has(extraId)
    ) {
      continue;
    }
    const baseRec = baseRecById.get(extraId);
    if (baseRec) {
      params.recMap.set(
        extraId,
        canonicalizeRecord(baseRec, params.workTable.fields, { preserveComputed: true })
      );
    }
  }
}

async function buildScopedWorkTables(params: {
  readonly localEngine: IVcsLocalEnginePort;
  readonly baseId: string;
  readonly workSchemaRaw: IBaseVcsSnapshot;
  readonly workingDelta: IVcsWorkingDelta;
  readonly scopedBaseById: ReadonlyMap<string, ITableVcsSnapshot>;
  readonly fullWorkTableIds: ReadonlySet<string>;
  readonly extraTouchedRecordIdsByTable?: ReadonlyMap<string, ReadonlySet<string>>;
}): Promise<Result<ITableVcsSnapshot[], DomainError>> {
  const scopedWorkTables: ITableVcsSnapshot[] = [];
  for (const workTable of params.workSchemaRaw.tables) {
    if (params.fullWorkTableIds.has(workTable.id)) {
      const recsRes = await captureFullTableRecordsFromEngine(
        params.localEngine,
        params.baseId,
        workTable.id
      );
      if (recsRes.isErr()) return err(recsRes.error);
      scopedWorkTables.push(
        canonicalizeTable({ ...workTable, records: recsRes.value }, { preserveComputed: true })
      );
      continue;
    }

    const tableDelta = params.workingDelta.tableDeltas.get(workTable.id);
    const recMap = new Map<string, IRecordVcsSnapshot>(
      (tableDelta?.upsertedRecords ?? []).map((r) => [r.id, r])
    );
    fillUntouchedRemoteIdsFromBase({
      workTable,
      dirtyIdSet: new Set(tableDelta?.dirtyRecordIds ?? []),
      deletedIdSet: new Set(tableDelta?.deletedRecordIds ?? []),
      recMap,
      baseRecords: params.scopedBaseById.get(workTable.id)?.records ?? [],
      extraIds: params.extraTouchedRecordIdsByTable?.get(workTable.id),
    });
    scopedWorkTables.push(
      canonicalizeTable(
        { ...workTable, records: Array.from(recMap.values()) },
        { preserveComputed: true }
      )
    );
  }
  return ok(scopedWorkTables);
}

async function tryLoadIndexedWorkspaceDiff(params: {
  readonly stateRepository: IVcsStateRepository;
  readonly localEngine: IVcsLocalEnginePort;
  readonly config: IVcsWorkspaceConfig;
  readonly conflicts: readonly IVcsConflict[];
  readonly options?: LoadIndexedWorkspaceDiffOptions;
}): Promise<Result<IndexedWorkspaceDiff | undefined, DomainError>> {
  const canUseIndexed = Boolean(
    params.stateRepository.readBaseSchemaSnapshot &&
    params.stateRepository.readBaseRecordsByIds &&
    params.localEngine.captureWorkingDelta
  );
  if (!canUseIndexed) return ok(undefined);

  const schemaSummaryRes = await params.stateRepository.readBaseSchemaSnapshot!();
  if (schemaSummaryRes.isErr()) return err(schemaSummaryRes.error);
  if (!schemaSummaryRes.value) {
    return err(
      vcsDomainError.notFound({
        code: 'vcs.missing_base_snapshot',
        message: 'VCS base snapshot is missing',
      })
    );
  }

  const { schemaSnapshot: baseSchema, totalRecords, tableRecordCounts } = schemaSummaryRes.value;
  if (params.config.readOnly) {
    // Remote comparisons may need the original rows for a merge. Use the full checkpoint then.
    if (
      params.options?.extraTouchedRecordIdsByTable?.size ||
      params.options?.forceFullRecordTables?.size
    ) {
      return ok(undefined);
    }
    return ok({
      isIndexed: true,
      config: params.config,
      baseSchema,
      totalBaseRecords: totalRecords,
      tableRecordCounts,
      baseSnapshot: baseSchema,
      workingSnapshot: baseSchema,
      conflicts: params.conflicts,
    });
  }
  const workingDeltaRes = await params.localEngine.captureWorkingDelta!(params.config.baseId, {
    baseName: params.config.baseName,
    revision: baseSchema.revision,
  });
  if (workingDeltaRes.isErr()) return err(workingDeltaRes.error);

  const workingDelta = workingDeltaRes.value;
  if (!workingDelta.isCompleteDelta) return ok(undefined);

  const workSchemaRaw: IBaseVcsSnapshot = baseSchema.accessScope
    ? { ...workingDelta.schemaSnapshot, accessScope: baseSchema.accessScope }
    : workingDelta.schemaSnapshot;
  const { fullBaseTableIds, fullWorkTableIds } = computeFullRecordTableSets(
    baseSchema,
    workSchemaRaw,
    params.options
  );

  const baseTablesRes = await buildScopedBaseTables({
    stateRepository: params.stateRepository,
    baseSchema,
    workingDelta,
    fullBaseTableIds,
    extraTouchedRecordIdsByTable: params.options?.extraTouchedRecordIdsByTable,
  });
  if (baseTablesRes.isErr()) return err(baseTablesRes.error);

  const scopedBaseById = new Map(baseTablesRes.value.map((t) => [t.id, t]));
  const workTablesRes = await buildScopedWorkTables({
    localEngine: params.localEngine,
    baseId: params.config.baseId,
    workSchemaRaw,
    workingDelta,
    scopedBaseById,
    fullWorkTableIds,
    extraTouchedRecordIdsByTable: params.options?.extraTouchedRecordIdsByTable,
  });
  if (workTablesRes.isErr()) return err(workTablesRes.error);

  return ok({
    isIndexed: true,
    config: params.config,
    baseSchema,
    totalBaseRecords: totalRecords,
    tableRecordCounts,
    baseSnapshot: canonicalizeSnapshot(
      { ...baseSchema, tables: baseTablesRes.value },
      { preserveComputed: true }
    ),
    workingSnapshot: canonicalizeSnapshot(
      { ...workSchemaRaw, tables: workTablesRes.value },
      { preserveComputed: true }
    ),
    workingDelta,
    conflicts: params.conflicts,
  });
}

function toMonolithicIndexedDiff(
  config: IVcsWorkspaceConfig,
  baseSnapshot: IBaseVcsSnapshot,
  workingSnapshot: IBaseVcsSnapshot,
  conflicts: readonly IVcsConflict[]
): IndexedWorkspaceDiff {
  const tableRecordCounts: Record<string, number> = {};
  let totalBaseRecords = 0;
  const schemaTables = baseSnapshot.tables.map((t) => {
    tableRecordCounts[t.id] = t.records.length;
    totalBaseRecords += t.records.length;
    return { ...t, records: [] };
  });
  return {
    isIndexed: false,
    config,
    baseSchema: canonicalizeSnapshot(
      { ...baseSnapshot, tables: schemaTables },
      { preserveComputed: true }
    ),
    totalBaseRecords,
    tableRecordCounts,
    baseSnapshot,
    workingSnapshot,
    conflicts,
  };
}

export async function loadIndexedWorkspaceDiff(
  stateRepository: IVcsStateRepository,
  localEngine: IVcsLocalEnginePort,
  options?: LoadIndexedWorkspaceDiffOptions
): Promise<Result<IndexedWorkspaceDiff, DomainError>> {
  const configRes = await stateRepository.readConfig();
  if (configRes.isErr()) return err(configRes.error);
  if (!configRes.value) {
    return err(
      vcsDomainError.notFound({
        code: 'vcs.not_initialized',
        message: 'VCS workspace is not initialized in this directory',
      })
    );
  }
  if (options?.requireWritable && configRes.value.readOnly) return err(readonlyCheckoutError());
  const conflictsRes = await stateRepository.readConflicts();
  if (conflictsRes.isErr()) return err(conflictsRes.error);

  const indexedRes = await tryLoadIndexedWorkspaceDiff({
    stateRepository,
    localEngine,
    config: configRes.value,
    conflicts: conflictsRes.value,
    options,
  });
  if (indexedRes.isErr()) return err(indexedRes.error);
  if (indexedRes.value) {
    const workspace = indexedRes.value;
    return ok(
      workspace.config.promotionBaselineRevision === undefined
        ? workspace
        : {
            ...workspace,
            workingSnapshot: alignPromotionWorkingSnapshot(
              workspace.workingSnapshot,
              workspace.baseSnapshot
            ),
          }
    );
  }

  const fallbackRes = await loadVcsWorkspace(stateRepository, localEngine);
  if (fallbackRes.isErr()) return err(fallbackRes.error);
  return ok(
    toMonolithicIndexedDiff(
      configRes.value,
      fallbackRes.value.baseSnapshot,
      configRes.value.promotionBaselineRevision === undefined
        ? fallbackRes.value.workingSnapshot
        : alignPromotionWorkingSnapshot(
            fallbackRes.value.workingSnapshot,
            fallbackRes.value.baseSnapshot
          ),
      conflictsRes.value
    )
  );
}

export interface RemoteLiveState {
  readonly snapshot: IBaseVcsSnapshot;
  readonly changes?: IVcsIncrementalChanges;
}

function withOptionalCursor(
  snapshot: IBaseVcsSnapshot,
  cursor: string | undefined
): IBaseVcsSnapshot {
  return cursor === undefined ? snapshot : { ...snapshot, cursor };
}

function hasIncrementalDelta(changes: IVcsIncrementalChanges): boolean {
  return (
    changes.upsertedTables.length > 0 ||
    changes.deletedTableIds.length > 0 ||
    changes.recordDeltas.length > 0 ||
    Boolean(changes.hasChanges)
  );
}

async function resolveFullSyncRemoteState(
  remoteGateway: IVcsRemoteGateway,
  config: IVcsWorkspaceConfig,
  changes: IVcsIncrementalChanges,
  cloneOpts: ICloneSnapshotOptions,
  nextCursor: string | undefined
): Promise<Result<RemoteLiveState, DomainError>> {
  if (changes.fullSnapshot) {
    return ok({
      snapshot: canonicalizeSnapshot(
        {
          ...changes.fullSnapshot,
          revision: changes.toRevision,
          ...(nextCursor !== undefined ? { cursor: nextCursor } : {}),
          ...(changes.accessScope ? { accessScope: changes.accessScope } : {}),
        },
        { preserveComputed: true }
      ),
      changes,
    });
  }
  const cloneRes = await remoteGateway.cloneSnapshot(config.baseId, cloneOpts);
  if (cloneRes.isErr()) return err(cloneRes.error);
  const snap = canonicalizeSnapshot(cloneRes.value.snapshot, { preserveComputed: true });
  return ok({
    snapshot: withOptionalCursor(snap, snap.cursor ?? nextCursor),
    changes,
  });
}

const MAX_INCREMENTAL_PULL_PAGES = 100;

function addTouchedIdToSet(map: Map<string, Set<string>>, tableId: string, recordId: string): void {
  let set = map.get(tableId);
  if (!set) {
    set = new Set();
    map.set(tableId, set);
  }
  set.add(recordId);
}

function applyPageTableChanges(
  page: IVcsIncrementalChanges,
  deletedTableIds: Set<string>,
  upsertedTablesMap: Map<string, ITableVcsSnapshot>,
  recordStatesByTable: Map<
    string,
    { upserts: Map<string, IRecordVcsSnapshot>; deletes: Set<string> }
  >,
  touchedRecordIdsByTable: Map<string, Set<string>>
): void {
  for (const delTableId of page.deletedTableIds) {
    deletedTableIds.add(delTableId);
    upsertedTablesMap.delete(delTableId);
    recordStatesByTable.delete(delTableId);
  }
  for (const upserted of page.upsertedTables) {
    deletedTableIds.delete(upserted.id);
    const prev = upsertedTablesMap.get(upserted.id);
    upsertedTablesMap.set(upserted.id, {
      ...upserted,
      records: upserted.records.length > 0 ? upserted.records : (prev?.records ?? []),
    });
    for (const rec of upserted.records)
      addTouchedIdToSet(touchedRecordIdsByTable, upserted.id, rec.id);
  }
}

function applyPageRecordDeltas(
  page: IVcsIncrementalChanges,
  recordStatesByTable: Map<
    string,
    { upserts: Map<string, IRecordVcsSnapshot>; deletes: Set<string> }
  >,
  touchedRecordIdsByTable: Map<string, Set<string>>
): void {
  for (const delta of page.recordDeltas) {
    let state = recordStatesByTable.get(delta.tableId);
    if (!state) {
      state = { upserts: new Map(), deletes: new Set() };
      recordStatesByTable.set(delta.tableId, state);
    }
    for (const delId of delta.deletes) {
      state.upserts.delete(delId);
      state.deletes.add(delId);
      addTouchedIdToSet(touchedRecordIdsByTable, delta.tableId, delId);
    }
    for (const upsertRec of delta.upserts) {
      state.deletes.delete(upsertRec.id);
      state.upserts.set(upsertRec.id, upsertRec);
      addTouchedIdToSet(touchedRecordIdsByTable, delta.tableId, upsertRec.id);
    }
  }
}

function mergeIncrementalPagesIntoPayload(
  baseId: string,
  baseName: string,
  fromRevision: number,
  pages: readonly IVcsIncrementalChanges[]
): {
  readonly changes: IVcsIncrementalChanges;
  readonly touchedRecordIdsByTable: Map<string, Set<string>>;
  readonly deletedTableIds: Set<string>;
} {
  const last = pages[pages.length - 1]!;
  const originPushIds = new Set<string>();
  let anyChanges = false;
  let latestAccessScope = last.accessScope;
  const deletedTableIds = new Set<string>();
  const upsertedTablesMap = new Map<string, ITableVcsSnapshot>();
  const recordStatesByTable = new Map<
    string,
    { upserts: Map<string, IRecordVcsSnapshot>; deletes: Set<string> }
  >();
  const touchedRecordIdsByTable = new Map<string, Set<string>>();

  for (const page of pages) {
    if (page.hasChanges) anyChanges = true;
    for (const id of page.originPushIds ?? []) originPushIds.add(id);
    if (page.accessScope) latestAccessScope = page.accessScope;
    applyPageTableChanges(
      page,
      deletedTableIds,
      upsertedTablesMap,
      recordStatesByTable,
      touchedRecordIdsByTable
    );
    applyPageRecordDeltas(page, recordStatesByTable, touchedRecordIdsByTable);
  }

  const recordDeltas: IVcsTableRecordDelta[] = Array.from(recordStatesByTable.entries()).map(
    ([tableId, state]) => ({
      tableId,
      upserts: Array.from(state.upserts.values()),
      deletes: Array.from(state.deletes),
    })
  );

  return {
    changes: {
      baseId,
      baseName: last.baseName || baseName,
      fromRevision,
      toRevision: last.toRevision,
      ...(last.nextCursor !== undefined ? { nextCursor: last.nextCursor } : {}),
      hasChanges: anyChanges,
      hasMore: false,
      originPushIds: Array.from(originPushIds),
      requiresFullSync: false,
      upsertedTables: Array.from(upsertedTablesMap.values()),
      deletedTableIds: Array.from(deletedTableIds),
      recordDeltas,
      ...(latestAccessScope ? { accessScope: latestAccessScope } : {}),
    },
    touchedRecordIdsByTable,
    deletedTableIds,
  };
}

function toFullSyncRemoteIncrementalState(fullState: RemoteLiveState): RemoteIncrementalState {
  return {
    isIncremental: false,
    fullSnapshot: fullState.snapshot,
    changes: fullState.changes,
    touchedRecordIdsByTable: new Map(),
    deletedTableIds: new Set(),
  };
}

function buildIncrementalPageOptions(
  tableIds: readonly string[] | undefined,
  cursor: string | undefined
): ICloneSnapshotOptions | undefined {
  const pageOpts: ICloneSnapshotOptions = {
    ...(tableIds ? { tableIds } : {}),
    ...(cursor !== undefined ? { cursor } : {}),
  };
  return Object.keys(pageOpts).length > 0 ? pageOpts : undefined;
}

export async function fetchRemoteIncrementalState(
  remoteGateway: IVcsRemoteGateway,
  config: IVcsWorkspaceConfig,
  baseSchema: IBaseVcsSnapshot
): Promise<Result<RemoteIncrementalState, DomainError>> {
  const initialCursor = config.pullCursor ?? baseSchema.cursor;
  const cloneOpts: ICloneSnapshotOptions = {
    ...(config.selectedTables ? { tableIds: config.selectedTables } : {}),
    ...(initialCursor !== undefined ? { cursor: initialCursor } : {}),
  };

  if (config.remoteMode === 'openapi-readonly') {
    const cloneRes = await remoteGateway.cloneSnapshot(config.baseId, cloneOpts);
    return cloneRes.map((val) => ({
      isIncremental: false,
      fullSnapshot: canonicalizeSnapshot(val.snapshot, { preserveComputed: true }),
      touchedRecordIdsByTable: new Map(),
      deletedTableIds: new Set(),
    }));
  }

  let currentCursor = initialCursor;
  const pages: IVcsIncrementalChanges[] = [];

  for (let pageIndex = 0; pageIndex <= MAX_INCREMENTAL_PULL_PAGES; pageIndex += 1) {
    const pageRes = await remoteGateway.fetchChanges(
      config.baseId,
      baseSchema.revision,
      buildIncrementalPageOptions(config.selectedTables, currentCursor)
    );
    if (pageRes.isErr()) return err(pageRes.error);

    const currentChanges = pageRes.value;
    currentCursor = currentChanges.nextCursor ?? currentCursor;
    if (currentChanges.requiresFullSync || pageIndex === MAX_INCREMENTAL_PULL_PAGES) {
      const fullRes = await resolveFullSyncRemoteState(
        remoteGateway,
        config,
        currentChanges,
        cloneOpts,
        currentCursor
      );
      return fullRes.map(toFullSyncRemoteIncrementalState);
    }

    pages.push(currentChanges);
    if (!currentChanges.hasMore) {
      const merged = mergeIncrementalPagesIntoPayload(
        config.baseId,
        currentChanges.baseName || config.baseName,
        baseSchema.revision,
        pages
      );
      return ok({
        isIncremental: true,
        changes: merged.changes,
        touchedRecordIdsByTable: merged.touchedRecordIdsByTable,
        deletedTableIds: merged.deletedTableIds,
      });
    }
  }

  return err(
    vcsDomainError.infrastructure({
      code: 'vcs.incremental_pagination_exhausted',
      message: 'Incremental VCS change pagination exceeded maximum page limit',
    })
  );
}

function mergePullChangesSummary(
  baseId: string,
  baseName: string,
  fromRevision: number,
  pages: readonly IVcsIncrementalChanges[]
): IVcsIncrementalChanges {
  return mergeIncrementalPagesIntoPayload(baseId, baseName, fromRevision, pages).changes;
}

function isNoopIncrementalPage(
  pageIndex: number,
  changes: IVcsIncrementalChanges,
  baseRevision: number
): boolean {
  return (
    pageIndex === 0 &&
    !changes.hasMore &&
    !hasIncrementalDelta(changes) &&
    changes.toRevision === baseRevision
  );
}

function finalizeIncrementalPages(
  config: IVcsWorkspaceConfig,
  fromRevision: number,
  currentSnapshot: IBaseVcsSnapshot,
  pages: readonly IVcsIncrementalChanges[],
  lastChanges: IVcsIncrementalChanges
): RemoteLiveState {
  const mergedChanges =
    pages.length === 1
      ? lastChanges
      : mergePullChangesSummary(config.baseId, lastChanges.baseName, fromRevision, pages);
  return { snapshot: currentSnapshot, changes: mergedChanges };
}

async function resolveIncrementalRemoteState(
  remoteGateway: IVcsRemoteGateway,
  config: IVcsWorkspaceConfig,
  baseSnapshot: IBaseVcsSnapshot,
  firstChanges: IVcsIncrementalChanges,
  cloneOpts: ICloneSnapshotOptions
): Promise<Result<RemoteLiveState, DomainError>> {
  let currentChanges = firstChanges;
  let currentSnapshot = baseSnapshot;
  let currentCursor = currentChanges.nextCursor ?? config.pullCursor ?? baseSnapshot.cursor;
  const pages: IVcsIncrementalChanges[] = [];

  for (let pageIndex = 0; pageIndex < MAX_INCREMENTAL_PULL_PAGES; pageIndex += 1) {
    if (currentChanges.requiresFullSync) {
      return resolveFullSyncRemoteState(
        remoteGateway,
        config,
        currentChanges,
        cloneOpts,
        currentCursor
      );
    }
    if (isNoopIncrementalPage(pageIndex, currentChanges, baseSnapshot.revision)) {
      return ok({
        snapshot: withOptionalCursor(baseSnapshot, currentCursor),
        changes: currentChanges,
      });
    }

    pages.push(currentChanges);
    currentSnapshot = withOptionalCursor(
      applyIncrementalChanges(currentSnapshot, currentChanges),
      currentCursor
    );
    if (!currentChanges.hasMore) {
      return ok(
        finalizeIncrementalPages(
          config,
          baseSnapshot.revision,
          currentSnapshot,
          pages,
          currentChanges
        )
      );
    }

    const nextPageRes = await remoteGateway.fetchChanges(config.baseId, baseSnapshot.revision, {
      ...(cloneOpts.tableIds ? { tableIds: cloneOpts.tableIds } : {}),
      ...(currentCursor !== undefined ? { cursor: currentCursor } : {}),
    });
    if (nextPageRes.isErr()) return err(nextPageRes.error);
    currentChanges = nextPageRes.value;
    currentCursor = currentChanges.nextCursor ?? currentCursor;
  }

  return resolveFullSyncRemoteState(
    remoteGateway,
    config,
    currentChanges,
    cloneOpts,
    currentCursor
  );
}

export interface LoadedRemoteAndLocalDiffState {
  readonly loaded: IndexedWorkspaceDiff;
  readonly theirsSnapshot: IBaseVcsSnapshot;
  readonly changes?: IVcsIncrementalChanges;
  readonly isIncremental: boolean;
}

function collectRemoteForceFullTables(
  baseSchema: IBaseVcsSnapshot,
  remoteState: RemoteIncrementalState
): Set<string> {
  const forceFull = new Set<string>(remoteState.deletedTableIds);
  const baseTableById = new Map(baseSchema.tables.map((t) => [t.id, t]));
  for (const upserted of remoteState.changes?.upsertedTables ?? []) {
    const baseTable = baseTableById.get(upserted.id);
    if (!baseTable) continue;
    const upsertedFieldIds = new Set(upserted.fields.map((f) => f.id));
    if (baseTable.fields.some((f) => !upsertedFieldIds.has(f.id))) {
      forceFull.add(upserted.id);
    }
  }
  return forceFull;
}

async function readWorkspaceBaseSchemaOnly(
  stateRepository: IVcsStateRepository
): Promise<Result<IBaseVcsSnapshot, DomainError>> {
  let baseSchema: IBaseVcsSnapshot | null = null;
  if (stateRepository.readBaseSchemaSnapshot) {
    const schemaRes = await stateRepository.readBaseSchemaSnapshot();
    if (schemaRes.isErr()) return err(schemaRes.error);
    baseSchema = schemaRes.value?.schemaSnapshot ?? null;
  } else {
    const baseRes = await stateRepository.readBaseSnapshot();
    if (baseRes.isErr()) return err(baseRes.error);
    if (baseRes.value) {
      baseSchema = {
        ...baseRes.value,
        tables: baseRes.value.tables.map((t) => ({ ...t, records: [] })),
      };
    }
  }
  if (!baseSchema) {
    return err(
      vcsDomainError.notFound({
        code: 'vcs.missing_base_snapshot',
        message: 'VCS base snapshot is missing',
      })
    );
  }
  return ok(baseSchema);
}

export async function loadRemoteAndLocalDiffState(
  remoteGateway: IVcsRemoteGateway,
  stateRepository: IVcsStateRepository,
  localEngine: IVcsLocalEnginePort,
  options?: {
    readonly includeComputedSchemaFullTable?: boolean;
    readonly rejectIfUnresolvedConflicts?: boolean;
    readonly requireWritable?: boolean;
  }
): Promise<Result<LoadedRemoteAndLocalDiffState, DomainError>> {
  const configRes = await stateRepository.readConfig();
  if (configRes.isErr()) return err(configRes.error);
  if (!configRes.value) {
    return err(
      vcsDomainError.notFound({
        code: 'vcs.not_initialized',
        message: 'VCS workspace is not initialized in this directory',
      })
    );
  }
  const config = configRes.value;
  if (options?.requireWritable && config.readOnly) return err(readonlyCheckoutError());

  const conflictsRes = await stateRepository.readConflicts();
  if (conflictsRes.isErr()) return err(conflictsRes.error);
  if (options?.rejectIfUnresolvedConflicts && conflictsRes.value.length > 0) {
    return err(
      vcsDomainError.conflict({
        code: 'vcs.unresolved_conflicts',
        message: `Cannot pull while ${conflictsRes.value.length} unresolved conflict(s) remain`,
      })
    );
  }

  const baseSchemaRes = await readWorkspaceBaseSchemaOnly(stateRepository);
  if (baseSchemaRes.isErr()) return err(baseSchemaRes.error);
  const baseSchema = baseSchemaRes.value;

  const remoteStateRes = await fetchRemoteIncrementalState(remoteGateway, config, baseSchema);
  if (remoteStateRes.isErr()) return err(remoteStateRes.error);
  const remoteState = remoteStateRes.value;

  if (!remoteState.isIncremental || !remoteState.changes) {
    const fullLoadedRes = await loadVcsWorkspace(stateRepository, localEngine);
    if (fullLoadedRes.isErr()) return err(fullLoadedRes.error);
    const full = fullLoadedRes.value;
    return ok({
      loaded: toMonolithicIndexedDiff(
        full.config,
        full.baseSnapshot,
        full.workingSnapshot,
        full.conflicts
      ),
      theirsSnapshot: canonicalizeSnapshot(remoteState.fullSnapshot!, { preserveComputed: true }),
      changes: remoteState.changes,
      isIncremental: false,
    });
  }

  const forceFullRecordTables = collectRemoteForceFullTables(baseSchema, remoteState);
  const loadedRes = await loadIndexedWorkspaceDiff(stateRepository, localEngine, {
    includeComputedSchemaFullTable: options?.includeComputedSchemaFullTable,
    extraTouchedRecordIdsByTable: remoteState.touchedRecordIdsByTable,
    forceFullRecordTables,
  });
  if (loadedRes.isErr()) return err(loadedRes.error);

  const nextCursor =
    remoteState.changes.nextCursor ?? config.pullCursor ?? loadedRes.value.baseSchema.cursor;
  const appliedTheirs = applyIncrementalChanges(loadedRes.value.baseSnapshot, remoteState.changes);
  const theirsSnapshot = canonicalizeSnapshot(withOptionalCursor(appliedTheirs, nextCursor), {
    preserveComputed: true,
  });

  return ok({
    loaded: loadedRes.value,
    theirsSnapshot,
    changes: remoteState.changes,
    isIncremental: true,
  });
}

export async function fetchRemoteLiveState(
  remoteGateway: IVcsRemoteGateway,
  config: IVcsWorkspaceConfig,
  baseSnapshot: IBaseVcsSnapshot
): Promise<Result<RemoteLiveState, DomainError>> {
  const cursor = config.pullCursor ?? baseSnapshot.cursor;
  const cloneOpts = {
    ...(config.selectedTables ? { tableIds: config.selectedTables } : {}),
    ...(cursor !== undefined ? { cursor } : {}),
  };
  if (config.remoteMode === 'openapi-readonly') {
    const cloneRes = await remoteGateway.cloneSnapshot(config.baseId, cloneOpts);
    if (cloneRes.isErr()) return err(cloneRes.error);
    return ok({
      snapshot: canonicalizeSnapshot(cloneRes.value.snapshot, { preserveComputed: true }),
    });
  }

  const changesRes = await remoteGateway.fetchChanges(
    config.baseId,
    baseSnapshot.revision,
    Object.keys(cloneOpts).length > 0 ? cloneOpts : undefined
  );
  if (changesRes.isErr()) return err(changesRes.error);

  return resolveIncrementalRemoteState(
    remoteGateway,
    config,
    baseSnapshot,
    changesRes.value,
    cloneOpts
  );
}

export async function fetchRemoteLiveSnapshot(
  remoteGateway: IVcsRemoteGateway,
  config: IVcsWorkspaceConfig,
  baseSnapshot: IBaseVcsSnapshot
): Promise<Result<IBaseVcsSnapshot, DomainError>> {
  const res = await fetchRemoteLiveState(remoteGateway, config, baseSnapshot);
  return res.map((state) => state.snapshot);
}
