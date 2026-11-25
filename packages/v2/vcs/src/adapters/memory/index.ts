import type { DomainError } from '@teable/v2-core';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { diffSnapshots, isEmptyPatch, summarizePatch } from '../../domain/diffSnapshots';
import { vcsDomainError } from '../../domain/errors';
import {
  canonicalizeSnapshot,
  canonicalizeTable,
  canonicalizeRecord,
  cloneVcsValue,
} from '../../domain/fieldClassification';
import {
  collectDeletedTableCasConflicts,
  collectTableFieldCasConflicts,
  collectTableRecordCasConflicts,
  collectTableViewCasConflicts,
} from '../../domain/liveCas';
import type {
  IBaseVcsPatch,
  IBaseVcsSnapshot,
  IRecordVcsSnapshot,
  ITableVcsPatch,
  ITableVcsSnapshot,
  IVcsCloneRecordsChunk,
  IVcsConflict,
  IVcsDirtyKey,
  IVcsEngineApplyResult,
  IVcsHeadInfo,
  IVcsIncrementalChanges,
  IVcsMergeState,
  IVcsPushCasConflict,
  IVcsPushRequest,
  IVcsPushResult,
  IVcsTableRecordDelta,
  IVcsWorkspaceConfig,
  VcsRemoteMode,
} from '../../domain/types';
import type {
  ICloneSnapshotOptions,
  IVcsBaseSchemaSummary,
  IVcsBaseStateMutationBatch,
  IVcsHydrateRecordChunkResult,
  IVcsLocalEnginePort,
  IVcsRemoteGateway,
  IVcsStateRepository,
} from '../../ports';

export interface IMemoryCaptureOptions {
  readonly baseName?: string;
  readonly revision?: number;
  readonly skipCaptureSnapshot?: boolean;
}

function evaluateLiveCasConflicts(
  current: IBaseVcsSnapshot,
  patch: IBaseVcsPatch
): IVcsPushCasConflict[] {
  const conflicts: IVcsPushCasConflict[] = [];
  const tableMap = new Map(current.tables.map((t) => [t.id, t]));

  for (const addTable of patch.tablesAdded) {
    const existing = tableMap.get(addTable.id);
    if (existing) {
      conflicts.push({
        key: `${addTable.id}:table:${addTable.id}`,
        tableId: addTable.id,
        entityType: 'table',
        entityId: addTable.id,
        before: null,
        current: existing,
      });
    }
  }

  for (const delTable of patch.tablesDeleted) {
    conflicts.push(...collectDeletedTableCasConflicts(delTable, tableMap.get(delTable.tableId)));
  }

  for (const tp of patch.tablesUpdated) {
    const liveTable = tableMap.get(tp.tableId);
    if (!liveTable) {
      conflicts.push({
        key: `${tp.tableId}:table:${tp.tableId}`,
        tableId: tp.tableId,
        entityType: 'table',
        entityId: tp.tableId,
        before: tp,
        current: null,
      });
      continue;
    }

    if (tp.nameChange && liveTable.name !== tp.nameChange.from) {
      conflicts.push({
        key: `${tp.tableId}:table:${tp.tableId}`,
        tableId: tp.tableId,
        entityType: 'table',
        entityId: tp.tableId,
        before: tp.nameChange.from,
        current: liveTable.name,
      });
    }

    const fieldMap = new Map(liveTable.fields.map((f) => [f.id, f]));
    const viewMap = new Map(liveTable.views.map((v) => [v.id, v]));
    const recMap = new Map(liveTable.records.map((r) => [r.id, r]));
    conflicts.push(
      ...collectTableFieldCasConflicts(tp.tableId, tp, fieldMap),
      ...collectTableViewCasConflicts(tp.tableId, tp, viewMap),
      ...collectTableRecordCasConflicts(tp.tableId, tp, fieldMap, liveTable.fields, recMap)
    );
  }

  return conflicts;
}

function filterSnapshotTables(
  snapshot: IBaseVcsSnapshot,
  tableIds?: readonly string[]
): IBaseVcsSnapshot {
  if (!tableIds || tableIds.length === 0) {
    return canonicalizeSnapshot(cloneVcsValue(snapshot));
  }
  const allowed = new Set(tableIds);
  return canonicalizeSnapshot({
    ...cloneVcsValue(snapshot),
    tables: snapshot.tables.filter((t) => allowed.has(t.id)),
  });
}

function applyFieldPatchesToMap(
  fields: ITableVcsSnapshot['fields'],
  patch: ITableVcsPatch
): ITableVcsSnapshot['fields'][number][] {
  const fieldMap = new Map(fields.map((f) => [f.id, cloneVcsValue(f)]));
  for (const deleted of patch.fieldsDeleted) {
    fieldMap.delete(deleted.fieldId);
  }
  for (const updated of patch.fieldsUpdated) {
    fieldMap.set(updated.fieldId, cloneVcsValue(updated.after));
  }
  for (const added of patch.fieldsAdded) {
    fieldMap.set(added.id, cloneVcsValue(added));
  }
  return Array.from(fieldMap.values());
}

function applyViewPatchesToMap(
  views: ITableVcsSnapshot['views'],
  patch: ITableVcsPatch
): ITableVcsSnapshot['views'][number][] {
  const viewMap = new Map(views.map((v) => [v.id, cloneVcsValue(v)]));
  for (const deleted of patch.viewsDeleted) {
    viewMap.delete(deleted.viewId);
  }
  for (const updated of patch.viewsUpdated) {
    viewMap.set(updated.viewId, cloneVcsValue(updated.after));
  }
  for (const added of patch.viewsAdded) {
    viewMap.set(added.id, cloneVcsValue(added));
  }
  return Array.from(viewMap.values());
}

function applyRecordPatchesToMap(
  records: ITableVcsSnapshot['records'],
  patch: ITableVcsPatch,
  nextFields: ITableVcsSnapshot['fields']
): IRecordVcsSnapshot[] {
  const recordMap = new Map(records.map((r) => [r.id, cloneVcsValue(r)]));
  for (const deleted of patch.recordsDeleted) {
    recordMap.delete(deleted.recordId);
  }
  for (const updated of patch.recordsUpdated) {
    const existing = recordMap.get(updated.recordId) ?? { id: updated.recordId, fields: {} };
    const nextRecordFields = { ...existing.fields };
    for (const cell of updated.cellChanges) {
      if (cell.after === null || cell.after === undefined) {
        delete nextRecordFields[cell.fieldId];
      } else {
        nextRecordFields[cell.fieldId] = cloneVcsValue(cell.after);
      }
    }
    recordMap.set(
      updated.recordId,
      canonicalizeRecord(
        {
          ...existing,
          fields: nextRecordFields,
          ...(updated.orderChanges?.length && {
            orders: {
              ...existing.orders,
              ...Object.fromEntries(
                updated.orderChanges.map(({ viewId, after }) => [viewId, after])
              ),
            },
          }),
        },
        nextFields
      )
    );
  }
  for (const added of patch.recordsAdded) {
    recordMap.set(added.id, canonicalizeRecord(cloneVcsValue(added), nextFields));
  }
  return Array.from(recordMap.values());
}

function applyTablePatchToSnapshot(
  table: ITableVcsSnapshot,
  patch: ITableVcsPatch,
  options?: { readonly preserveComputed?: boolean }
): ITableVcsSnapshot {
  const nextName = patch.nameChange ? patch.nameChange.to : table.name;
  const nextFields = applyFieldPatchesToMap(table.fields, patch);
  const nextViews = applyViewPatchesToMap(table.views, patch);
  const nextRecords = applyRecordPatchesToMap(table.records, patch, nextFields);

  return canonicalizeTable(
    {
      ...table,
      name: nextName,
      fields: nextFields,
      views: nextViews,
      records: nextRecords,
    },
    options
  );
}

export function applyPatchToSnapshot(
  snapshot: IBaseVcsSnapshot,
  patch: IBaseVcsPatch,
  options?: IMemoryCaptureOptions & { readonly preserveComputed?: boolean }
): IBaseVcsSnapshot {
  const tableMap = new Map<string, ITableVcsSnapshot>(
    snapshot.tables.map((t) => [t.id, cloneVcsValue(t)])
  );

  for (const deleted of patch.tablesDeleted) {
    tableMap.delete(deleted.tableId);
  }
  for (const updated of patch.tablesUpdated) {
    const existing = tableMap.get(updated.tableId);
    if (existing) {
      tableMap.set(
        updated.tableId,
        applyTablePatchToSnapshot(existing, updated, {
          preserveComputed: options?.preserveComputed,
        })
      );
    }
  }
  for (const added of patch.tablesAdded) {
    tableMap.set(
      added.id,
      canonicalizeTable(cloneVcsValue(added), {
        preserveComputed: options?.preserveComputed,
      })
    );
  }

  return canonicalizeSnapshot(
    {
      ...cloneVcsValue(snapshot),
      baseName: options?.baseName ?? snapshot.baseName,
      revision: options?.revision ?? snapshot.revision,
      capturedAt: new Date().toISOString(),
      tables: Array.from(tableMap.values()),
    },
    { preserveComputed: options?.preserveComputed }
  );
}

function collectEntityDirtyKeys(
  revision: number,
  tableId: string,
  now: string,
  entityType: IVcsDirtyKey['entityType'],
  upsertIds: readonly string[],
  deleteIds: readonly string[]
): IVcsDirtyKey[] {
  const keys: IVcsDirtyKey[] = [];
  for (const entityId of upsertIds) {
    keys.push({ revision, tableId, entityType, entityId, opKind: 'upsert', createdAt: now });
  }
  for (const entityId of deleteIds) {
    keys.push({ revision, tableId, entityType, entityId, opKind: 'delete', createdAt: now });
  }
  return keys;
}

function collectTableDirtyKeys(revision: number, t: ITableVcsPatch, now: string): IVcsDirtyKey[] {
  const keys: IVcsDirtyKey[] = [];
  if (t.nameChange) {
    keys.push({
      revision,
      tableId: t.tableId,
      entityType: 'table',
      entityId: t.tableId,
      opKind: 'upsert',
      createdAt: now,
    });
  }
  keys.push(
    ...collectEntityDirtyKeys(
      revision,
      t.tableId,
      now,
      'field',
      [...t.fieldsAdded.map((f) => f.id), ...t.fieldsUpdated.map((f) => f.fieldId)],
      t.fieldsDeleted.map((f) => f.fieldId)
    ),
    ...collectEntityDirtyKeys(
      revision,
      t.tableId,
      now,
      'view',
      [...t.viewsAdded.map((v) => v.id), ...t.viewsUpdated.map((v) => v.viewId)],
      t.viewsDeleted.map((v) => v.viewId)
    ),
    ...collectEntityDirtyKeys(
      revision,
      t.tableId,
      now,
      'record',
      [...t.recordsAdded.map((r) => r.id), ...t.recordsUpdated.map((r) => r.recordId)],
      t.recordsDeleted.map((r) => r.recordId)
    )
  );
  return keys;
}

function collectDirtyKeysFromPatch(revision: number, patch: IBaseVcsPatch): IVcsDirtyKey[] {
  const keys: IVcsDirtyKey[] = [];
  const now = new Date().toISOString();

  for (const t of patch.tablesAdded) {
    keys.push({
      revision,
      tableId: t.id,
      entityType: 'table',
      entityId: t.id,
      opKind: 'upsert',
      createdAt: now,
    });
  }
  for (const t of patch.tablesDeleted) {
    keys.push({
      revision,
      tableId: t.tableId,
      entityType: 'table',
      entityId: t.tableId,
      opKind: 'delete',
      createdAt: now,
    });
  }
  for (const t of patch.tablesUpdated) {
    keys.push(...collectTableDirtyKeys(revision, t, now));
  }
  return keys;
}

function tablePatchHasSchemaOrViewChange(tablePatch: ITableVcsPatch): boolean {
  return (
    tablePatch.nameChange !== undefined ||
    tablePatch.fieldsAdded.length > 0 ||
    tablePatch.fieldsUpdated.length > 0 ||
    tablePatch.fieldsDeleted.length > 0 ||
    tablePatch.viewsAdded.length > 0 ||
    tablePatch.viewsUpdated.length > 0 ||
    tablePatch.viewsDeleted.length > 0
  );
}

function buildRecordDeltaForTablePatch(
  tablePatch: ITableVcsPatch,
  curTable: ITableVcsSnapshot
): IVcsTableRecordDelta | null {
  const hasRecordChange =
    tablePatch.recordsAdded.length > 0 ||
    tablePatch.recordsUpdated.length > 0 ||
    tablePatch.recordsDeleted.length > 0;
  if (!hasRecordChange) return null;

  const curRecMap = new Map(curTable.records.map((r) => [r.id, r]));
  const upserts: IRecordVcsSnapshot[] = [...tablePatch.recordsAdded];
  for (const updatedRec of tablePatch.recordsUpdated) {
    const fullRec = curRecMap.get(updatedRec.recordId);
    if (fullRec) {
      upserts.push(fullRec);
    }
  }
  return {
    tableId: tablePatch.tableId,
    upserts,
    deletes: tablePatch.recordsDeleted.map((d) => d.recordId),
  };
}

export class InMemoryVcsRemoteGateway implements IVcsRemoteGateway {
  private readonly snapshots = new Map<string, IBaseVcsSnapshot>();
  private readonly history = new Map<string, Map<number, IBaseVcsSnapshot>>();
  private readonly dirtyLogs = new Map<string, IVcsDirtyKey[]>();
  private readonly remoteMode: VcsRemoteMode;

  constructor(options?: { initialSnapshot?: IBaseVcsSnapshot; remoteMode?: VcsRemoteMode }) {
    this.remoteMode = options?.remoteMode ?? 'v2-vcs';
    if (options?.initialSnapshot) {
      this.seedSnapshot(options.initialSnapshot);
    }
  }

  seedSnapshot(
    snapshot: IBaseVcsSnapshot,
    extraDirtyKeys?: readonly Omit<IVcsDirtyKey, 'revision'>[]
  ): void {
    const canonical = canonicalizeSnapshot(cloneVcsValue(snapshot));
    const prev = this.snapshots.get(canonical.baseId);
    this.snapshots.set(canonical.baseId, canonical);

    let revMap = this.history.get(canonical.baseId);
    if (!revMap) {
      revMap = new Map<number, IBaseVcsSnapshot>();
      this.history.set(canonical.baseId, revMap);
    }
    revMap.set(canonical.revision, canonical);

    const log = this.dirtyLogs.get(canonical.baseId) ?? [];
    if (extraDirtyKeys && extraDirtyKeys.length > 0) {
      for (const item of extraDirtyKeys) {
        log.push({ ...item, revision: canonical.revision });
      }
    } else if (prev && prev.revision < canonical.revision) {
      const diff = diffSnapshots(prev, canonical);
      log.push(...collectDirtyKeysFromPatch(canonical.revision, diff));
    }
    this.dirtyLogs.set(canonical.baseId, log);
  }

  applyServerMutation(
    baseId: string,
    mutator: (current: IBaseVcsSnapshot) => IBaseVcsSnapshot
  ): IBaseVcsSnapshot {
    const current = this.snapshots.get(baseId);
    if (!current) {
      throw new Error(`Base ${baseId} not seeded in InMemoryVcsRemoteGateway`);
    }
    const mutated = mutator(cloneVcsValue(current));
    const next = canonicalizeSnapshot({
      ...mutated,
      revision: current.revision + 1,
      capturedAt: new Date().toISOString(),
    });
    this.seedSnapshot(next);
    return next;
  }

  getSnapshot(baseId: string): IBaseVcsSnapshot | undefined {
    const found = this.snapshots.get(baseId);
    return found ? cloneVcsValue(found) : undefined;
  }

  async getHead(baseId: string): Promise<Result<IVcsHeadInfo, DomainError>> {
    const snapshot = this.snapshots.get(baseId);
    if (!snapshot) {
      return err(
        vcsDomainError.notFound({
          code: 'vcs.base_not_found',
          message: `Base ${baseId} not found`,
        })
      );
    }
    return ok({
      baseId: snapshot.baseId,
      baseName: snapshot.baseName,
      headRevision: snapshot.revision,
      vcsEnabled: this.remoteMode === 'v2-vcs',
      remoteMode: this.remoteMode,
    });
  }

  async enableBaseVcs(baseId: string): Promise<Result<IVcsHeadInfo, DomainError>> {
    if (this.remoteMode === 'openapi-readonly') {
      return err(
        vcsDomainError.forbidden({
          code: 'vcs.readonly_remote',
          message: 'Remote is read-only',
        })
      );
    }
    return this.getHead(baseId);
  }

  async cloneSnapshot(
    baseId: string,
    options?: ICloneSnapshotOptions
  ): Promise<Result<{ snapshot: IBaseVcsSnapshot; remoteMode: VcsRemoteMode }, DomainError>> {
    const snapshot = this.snapshots.get(baseId);
    if (!snapshot) {
      return err(
        vcsDomainError.notFound({
          code: 'vcs.base_not_found',
          message: `Base ${baseId} not found`,
        })
      );
    }
    const filtered = filterSnapshotTables(snapshot, options?.tableIds);
    const includeRecords = options?.includeRecords !== false;
    return ok({
      snapshot: includeRecords
        ? filtered
        : {
            ...filtered,
            tables: filtered.tables.map((t) => ({ ...t, records: [] })),
          },
      remoteMode: this.remoteMode,
    });
  }

  async cloneTableRecordsChunk(
    baseId: string,
    tableId: string,
    options?: { readonly cursor?: string; readonly limit?: number }
  ): Promise<Result<IVcsCloneRecordsChunk, DomainError>> {
    const snapshot = this.snapshots.get(baseId);
    if (!snapshot) {
      return err(
        vcsDomainError.notFound({
          code: 'vcs.base_not_found',
          message: `Base ${baseId} not found`,
        })
      );
    }
    const table = snapshot.tables.find((t) => t.id === tableId);
    if (!table) {
      return err(
        vcsDomainError.notFound({
          code: 'vcs.table_not_found',
          message: `Table ${tableId} not found in base ${baseId}`,
        })
      );
    }
    const offset = options?.cursor ? Math.max(0, Number.parseInt(options.cursor, 10) || 0) : 0;
    const limit = Math.min(2000, Math.max(1, Math.floor(options?.limit ?? 500)));
    const slice = table.records.slice(offset, offset + limit).map((r) => cloneVcsValue(r));
    const nextOffset = offset + slice.length;
    const hasMore = nextOffset < table.records.length;
    return ok({
      tableId,
      records: slice,
      ...(hasMore ? { nextCursor: String(nextOffset) } : {}),
      hasMore,
    });
  }

  async fetchChanges(
    baseId: string,
    sinceRevision: number,
    options?: ICloneSnapshotOptions
  ): Promise<Result<IVcsIncrementalChanges, DomainError>> {
    const current = this.snapshots.get(baseId);
    if (!current) {
      return err(
        vcsDomainError.notFound({
          code: 'vcs.base_not_found',
          message: `Base ${baseId} not found`,
        })
      );
    }

    const revMap = this.history.get(baseId);
    const sinceSnapshot = revMap?.get(sinceRevision);
    const filteredCurrent = filterSnapshotTables(current, options?.tableIds);

    if (!sinceSnapshot) {
      return ok({
        baseId: current.baseId,
        baseName: current.baseName,
        fromRevision: sinceRevision,
        toRevision: current.revision,
        requiresFullSync: true,
        fullSnapshot: filteredCurrent,
        upsertedTables: [],
        deletedTableIds: [],
        recordDeltas: [],
        ...(filteredCurrent.accessScope ? { accessScope: filteredCurrent.accessScope } : {}),
      });
    }

    const filteredSince = filterSnapshotTables(sinceSnapshot, options?.tableIds);
    const patch = diffSnapshots(filteredSince, filteredCurrent);

    const upsertedTables: ITableVcsSnapshot[] = [...patch.tablesAdded];
    const recordDeltas: IVcsTableRecordDelta[] = [];
    const currentTableMap = new Map(filteredCurrent.tables.map((t) => [t.id, t]));

    for (const tablePatch of patch.tablesUpdated) {
      const curTable = currentTableMap.get(tablePatch.tableId);
      if (!curTable) continue;
      if (tablePatchHasSchemaOrViewChange(tablePatch)) {
        upsertedTables.push({
          ...curTable,
          records: [],
        });
      }
      const delta = buildRecordDeltaForTablePatch(tablePatch, curTable);
      if (delta) {
        recordDeltas.push(delta);
      }
    }

    return ok({
      baseId: current.baseId,
      baseName: current.baseName,
      fromRevision: sinceRevision,
      toRevision: current.revision,
      requiresFullSync: false,
      upsertedTables,
      deletedTableIds: patch.tablesDeleted.map((d) => d.tableId),
      recordDeltas,
      ...(filteredCurrent.accessScope ? { accessScope: filteredCurrent.accessScope } : {}),
    });
  }

  async pushPatch(request: IVcsPushRequest): Promise<Result<IVcsPushResult, DomainError>> {
    if (this.remoteMode === 'openapi-readonly') {
      return err(
        vcsDomainError.forbidden({
          code: 'vcs.readonly_remote',
          message: 'Remote is read-only',
        })
      );
    }

    const current = this.snapshots.get(request.baseId);
    if (!current) {
      return err(
        vcsDomainError.notFound({
          code: 'vcs.base_not_found',
          message: `Base ${request.baseId} not found`,
        })
      );
    }

    const summary = summarizePatch(request.patch);
    const dryRun = Boolean(request.dryRun);

    if (isEmptyPatch(request.patch)) {
      return ok({
        ok: true,
        dryRun,
        baseId: request.baseId,
        baseRevision: request.baseRevision,
        newRevision: current.revision,
        rebased: false,
        summary,
      });
    }

    const rebased = request.baseRevision < current.revision;
    const conflicts = evaluateLiveCasConflicts(current, request.patch);
    if (conflicts.length > 0) {
      return ok({
        ok: false,
        dryRun,
        baseId: request.baseId,
        baseRevision: request.baseRevision,
        newRevision: current.revision,
        rebased: false,
        summary,
        conflictError: {
          code: 'vcs.cas_conflict',
          message: `CAS conflict while pushing to revision ${current.revision}`,
          headRevision: current.revision,
          overlappingKeys: conflicts.map((c) => c.key),
          conflicts,
        },
      });
    }

    const nextRevision = current.revision + 1;
    if (dryRun) {
      return ok({
        ok: true,
        dryRun: true,
        baseId: request.baseId,
        baseRevision: request.baseRevision,
        newRevision: nextRevision,
        commitId: `cmt_dry_${nextRevision}`,
        ...(request.originPushId ? { originPushId: request.originPushId } : {}),
        rebased,
        summary,
      });
    }

    const tableMap = new Map(current.tables.map((t) => [t.id, cloneVcsValue(t)]));
    for (const del of request.patch.tablesDeleted) {
      tableMap.delete(del.tableId);
    }
    for (const upd of request.patch.tablesUpdated) {
      const existing = tableMap.get(upd.tableId);
      if (existing) {
        tableMap.set(upd.tableId, applyTablePatchToSnapshot(existing, upd));
      }
    }
    for (const add of request.patch.tablesAdded) {
      tableMap.set(add.id, canonicalizeTable(cloneVcsValue(add)));
    }

    const nextSnapshot = canonicalizeSnapshot({
      ...current,
      revision: nextRevision,
      capturedAt: new Date().toISOString(),
      tables: Array.from(tableMap.values()),
    });

    const dirtyKeys = collectDirtyKeysFromPatch(nextRevision, request.patch);
    this.seedSnapshot(nextSnapshot, dirtyKeys);

    return ok({
      ok: true,
      dryRun: false,
      baseId: request.baseId,
      baseRevision: request.baseRevision,
      newRevision: nextRevision,
      commitId: `cmt_${nextRevision}`,
      ...(request.originPushId ? { originPushId: request.originPushId } : {}),
      rebased,
      summary,
    });
  }
}

export class InMemoryLocalEngineAdapter implements IVcsLocalEnginePort {
  private readonly bases = new Map<string, IBaseVcsSnapshot>();

  constructor(initialSnapshots?: IBaseVcsSnapshot | readonly IBaseVcsSnapshot[]) {
    if (!initialSnapshots) return;
    const list = Array.isArray(initialSnapshots) ? initialSnapshots : [initialSnapshots];
    for (const snapshot of list) {
      this.bases.set(
        snapshot.baseId,
        canonicalizeSnapshot(cloneVcsValue(snapshot), { preserveComputed: true })
      );
    }
  }

  async hasBase(baseId: string): Promise<Result<boolean, DomainError>> {
    return ok(this.bases.has(baseId));
  }

  async captureSnapshot(
    baseId: string,
    options?: IMemoryCaptureOptions
  ): Promise<Result<IBaseVcsSnapshot, DomainError>> {
    const existing = this.bases.get(baseId);
    if (!existing) {
      return err(
        vcsDomainError.notFound({
          code: 'vcs.base_not_found',
          message: `Base ${baseId} does not exist in memory local engine`,
          details: { baseId },
        })
      );
    }
    return ok(
      canonicalizeSnapshot(
        {
          ...cloneVcsValue(existing),
          ...(options?.baseName ? { baseName: options.baseName } : {}),
          ...(options?.revision !== undefined ? { revision: options.revision } : {}),
        },
        { preserveComputed: true }
      )
    );
  }

  async hydrateSnapshot(
    snapshot: IBaseVcsSnapshot,
    options?: IMemoryCaptureOptions
  ): Promise<Result<IVcsEngineApplyResult, DomainError>> {
    const canonical = canonicalizeSnapshot(cloneVcsValue(snapshot), {
      preserveComputed: true,
    });
    this.bases.set(snapshot.baseId, canonical);
    return ok({
      applied: true,
      recomputedCells: 0,
      ...(options?.skipCaptureSnapshot ? {} : { snapshot: cloneVcsValue(canonical) }),
    });
  }

  async applyPatch(
    baseId: string,
    patch: IBaseVcsPatch,
    options?: IMemoryCaptureOptions
  ): Promise<Result<IVcsEngineApplyResult, DomainError>> {
    const existing = this.bases.get(baseId);
    if (!existing) {
      return err(
        vcsDomainError.notFound({
          code: 'vcs.base_not_found',
          message: `Base ${baseId} does not exist in memory local engine`,
          details: { baseId },
        })
      );
    }
    const next = applyPatchToSnapshot(existing, patch, {
      ...options,
      preserveComputed: true,
    });
    this.bases.set(baseId, next);
    return ok({
      applied: true,
      recomputedCells: 0,
      ...(options?.skipCaptureSnapshot ? {} : { snapshot: cloneVcsValue(next) }),
    });
  }

  async hydrateRecordChunk(params: {
    readonly baseId: string;
    readonly tableId: string;
    readonly records: readonly IRecordVcsSnapshot[];
    readonly mode?: 'scalar-insert' | 'link-update';
  }): Promise<Result<IVcsHydrateRecordChunkResult, DomainError>> {
    const existing = this.bases.get(params.baseId);
    if (!existing) {
      return err(
        vcsDomainError.notFound({
          code: 'vcs.base_not_found',
          message: `Base ${params.baseId} does not exist in memory local engine`,
        })
      );
    }
    const tableIdx = existing.tables.findIndex((t) => t.id === params.tableId);
    if (tableIdx < 0) {
      return err(
        vcsDomainError.notFound({
          code: 'vcs.table_not_found',
          message: `Table ${params.tableId} does not exist in memory local engine`,
        })
      );
    }
    const targetTable = existing.tables[tableIdx]!;
    const recMap = new Map(targetTable.records.map((r) => [r.id, r]));
    for (const rec of params.records) {
      const prev = recMap.get(rec.id);
      recMap.set(
        rec.id,
        canonicalizeRecord(
          {
            id: rec.id,
            autoNumber: rec.autoNumber ?? prev?.autoNumber,
            fields: prev
              ? { ...prev.fields, ...cloneVcsValue(rec.fields) }
              : cloneVcsValue(rec.fields),
            ...(rec.version !== undefined
              ? { version: rec.version }
              : prev?.version !== undefined
                ? { version: prev.version }
                : {}),
            ...(rec.orders
              ? { orders: cloneVcsValue(rec.orders) }
              : prev?.orders
                ? { orders: prev.orders }
                : {}),
          },
          targetTable.fields,
          { preserveComputed: true }
        )
      );
    }
    const nextTables = [...existing.tables];
    nextTables[tableIdx] = canonicalizeTable(
      { ...targetTable, records: Array.from(recMap.values()) },
      { preserveComputed: true }
    );
    this.bases.set(
      params.baseId,
      canonicalizeSnapshot({ ...existing, tables: nextTables }, { preserveComputed: true })
    );
    return ok({ deferredLinkRecords: [] });
  }

  async flushComputed(_baseId: string): Promise<Result<number, DomainError>> {
    return ok(0);
  }

  async captureTableRecordsChunk(
    baseId: string,
    tableId: string,
    options?: { readonly cursor?: string; readonly limit?: number }
  ): Promise<Result<IVcsCloneRecordsChunk, DomainError>> {
    const existing = this.bases.get(baseId);
    if (!existing) {
      return err(
        vcsDomainError.notFound({
          code: 'vcs.base_not_found',
          message: `Base ${baseId} does not exist in memory local engine`,
        })
      );
    }
    const table = existing.tables.find((t) => t.id === tableId);
    if (!table) {
      return err(
        vcsDomainError.notFound({
          code: 'vcs.table_not_found',
          message: `Table ${tableId} does not exist in memory local engine`,
        })
      );
    }
    const offset = options?.cursor ? Math.max(0, Number.parseInt(options.cursor, 10) || 0) : 0;
    const limit = Math.min(2000, Math.max(1, Math.floor(options?.limit ?? 500)));
    const slice = table.records.slice(offset, offset + limit).map((r) => cloneVcsValue(r));
    const nextOffset = offset + slice.length;
    const hasMore = nextOffset < table.records.length;
    return ok({
      tableId,
      records: slice,
      ...(hasMore ? { nextCursor: String(nextOffset) } : {}),
      hasMore,
    });
  }

  async reset(): Promise<Result<void, DomainError>> {
    this.bases.clear();
    return ok(undefined);
  }
}

export class InMemoryVcsStateRepository implements IVcsStateRepository {
  private config: IVcsWorkspaceConfig | null = null;
  private baseSnapshot: IBaseVcsSnapshot | null = null;
  private conflicts: readonly IVcsConflict[] = [];
  private mergeState: IVcsMergeState | null = null;

  async readConfig(): Promise<Result<IVcsWorkspaceConfig | null, DomainError>> {
    return ok(this.config ? cloneVcsValue(this.config) : null);
  }

  async writeConfig(config: IVcsWorkspaceConfig): Promise<Result<void, DomainError>> {
    this.config = cloneVcsValue(config);
    return ok(undefined);
  }

  async readBaseSnapshot(): Promise<Result<IBaseVcsSnapshot | null, DomainError>> {
    return ok(this.baseSnapshot ? cloneVcsValue(this.baseSnapshot) : null);
  }

  async writeBaseSnapshot(snapshot: IBaseVcsSnapshot): Promise<Result<void, DomainError>> {
    this.baseSnapshot = canonicalizeSnapshot(cloneVcsValue(snapshot), {
      preserveComputed: true,
    });
    return ok(undefined);
  }

  async readBaseSchemaSnapshot(): Promise<Result<IVcsBaseSchemaSummary | null, DomainError>> {
    if (!this.baseSnapshot) return ok(null);
    const tableRecordCounts: Record<string, number> = {};
    let totalRecords = 0;
    const schemaTables = this.baseSnapshot.tables.map((t) => {
      tableRecordCounts[t.id] = t.records.length;
      totalRecords += t.records.length;
      return { ...cloneVcsValue(t), records: [] };
    });
    return ok({
      schemaSnapshot: canonicalizeSnapshot(
        { ...cloneVcsValue(this.baseSnapshot), tables: schemaTables },
        { preserveComputed: true }
      ),
      tableRecordCounts,
      totalRecords,
    });
  }

  async writeBaseSchemaSnapshot(
    schemaSnapshot: IBaseVcsSnapshot
  ): Promise<Result<void, DomainError>> {
    this.baseSnapshot = canonicalizeSnapshot(
      {
        ...cloneVcsValue(schemaSnapshot),
        tables: schemaSnapshot.tables.map((t) => ({ ...cloneVcsValue(t), records: [] })),
      },
      { preserveComputed: true }
    );
    return ok(undefined);
  }

  async readBaseRecordsByIds(
    tableId: string,
    recordIds: readonly string[]
  ): Promise<Result<ReadonlyMap<string, IRecordVcsSnapshot>, DomainError>> {
    const out = new Map<string, IRecordVcsSnapshot>();
    if (!this.baseSnapshot || recordIds.length === 0) return ok(out);
    const wanted = new Set(recordIds);
    const table = this.baseSnapshot.tables.find((t) => t.id === tableId);
    if (!table) return ok(out);
    for (const rec of table.records) {
      if (wanted.has(rec.id)) {
        out.set(rec.id, cloneVcsValue(rec));
      }
    }
    return ok(out);
  }

  private applyTableSchemaMutations(
    tableMap: Map<string, ITableVcsSnapshot>,
    batch: IVcsBaseStateMutationBatch
  ): void {
    for (const delId of batch.tablesDeleted ?? []) {
      tableMap.delete(delId);
    }
    for (const added of batch.tablesAdded ?? []) {
      tableMap.set(added.id, canonicalizeTable(cloneVcsValue(added), { preserveComputed: true }));
    }
    for (const updSchema of batch.tablesSchemaUpdated ?? []) {
      const prev = tableMap.get(updSchema.id);
      tableMap.set(
        updSchema.id,
        canonicalizeTable(
          { ...cloneVcsValue(updSchema), records: prev ? prev.records : [] },
          { preserveComputed: true }
        )
      );
    }
  }

  private applyTableRecordMutations(
    tableMap: Map<string, ITableVcsSnapshot>,
    recordChanges: IVcsBaseStateMutationBatch['recordChanges']
  ): void {
    for (const recChange of recordChanges ?? []) {
      const table = tableMap.get(recChange.tableId);
      if (!table) continue;
      const recMap = new Map(table.records.map((r) => [r.id, cloneVcsValue(r)]));
      for (const delId of recChange.deleteIds ?? []) {
        recMap.delete(delId);
      }
      for (const upsert of recChange.upserts ?? []) {
        recMap.set(
          upsert.id,
          canonicalizeRecord(cloneVcsValue(upsert), table.fields, { preserveComputed: true })
        );
      }
      tableMap.set(
        recChange.tableId,
        canonicalizeTable(
          { ...table, records: Array.from(recMap.values()) },
          { preserveComputed: true }
        )
      );
    }
  }

  async applyBaseStateMutations(
    batch: IVcsBaseStateMutationBatch
  ): Promise<Result<void, DomainError>> {
    if (!this.baseSnapshot) {
      return err(
        vcsDomainError.notFound({
          code: 'vcs.missing_base_snapshot',
          message: 'Cannot apply baseline mutations before base schema is initialized',
        })
      );
    }
    const tableMap = new Map<string, ITableVcsSnapshot>(
      this.baseSnapshot.tables.map((t) => [t.id, cloneVcsValue(t)])
    );
    this.applyTableSchemaMutations(tableMap, batch);
    this.applyTableRecordMutations(tableMap, batch.recordChanges);

    this.baseSnapshot = canonicalizeSnapshot(
      {
        ...this.baseSnapshot,
        ...(batch.baseName !== undefined ? { baseName: batch.baseName } : {}),
        ...(batch.revision !== undefined ? { revision: batch.revision } : {}),
        ...(batch.cursor !== undefined ? { cursor: batch.cursor } : {}),
        ...(batch.accessScope !== undefined ? { accessScope: batch.accessScope } : {}),
        capturedAt: new Date().toISOString(),
        tables: Array.from(tableMap.values()),
      },
      { preserveComputed: true }
    );
    return ok(undefined);
  }

  async readConflicts(): Promise<Result<readonly IVcsConflict[], DomainError>> {
    return ok(cloneVcsValue(this.conflicts));
  }

  async writeConflicts(conflicts: readonly IVcsConflict[]): Promise<Result<void, DomainError>> {
    this.conflicts = cloneVcsValue(conflicts);
    return ok(undefined);
  }

  async readMergeState(): Promise<Result<IVcsMergeState | null, DomainError>> {
    return ok(this.mergeState ? cloneVcsValue(this.mergeState) : null);
  }

  async writeMergeState(state: IVcsMergeState | null): Promise<Result<void, DomainError>> {
    this.mergeState = state ? cloneVcsValue(state) : null;
    return ok(undefined);
  }
}
