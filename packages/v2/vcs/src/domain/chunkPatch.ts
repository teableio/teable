import {
  canonicalizeField,
  canonicalizeTable,
  canonicalizeView,
  cloneVcsValue,
  deepEqualVcs,
  normalizeRecordFields,
  sortFieldsCanonically,
  sortViewsCanonically,
} from './fieldClassification';
import type {
  IBaseVcsAccessScope,
  IBaseVcsPatch,
  ICellChangePatch,
  IDeletedTableVcsPatch,
  IFieldVcsSnapshot,
  IRecordVcsSnapshot,
  ITableVcsPatch,
  ITableVcsSnapshot,
} from './types';

export const DEFAULT_MAX_RECORD_OPS_PER_PUSH_BATCH = 1_000;
export const MAX_SINGLE_TX_PUSH_RECORD_OPS = 5_000;

export function isPlainRecordObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function extractLinkItems(value: unknown): Array<{ id: string; raw: unknown }> {
  if (Array.isArray(value)) {
    return value.flatMap((entry) =>
      isPlainRecordObject(entry) && typeof entry.id === 'string' && entry.id.length > 0
        ? [{ id: entry.id, raw: entry }]
        : []
    );
  }
  if (isPlainRecordObject(value) && typeof value.id === 'string' && value.id.length > 0) {
    return [{ id: value.id, raw: value }];
  }
  return [];
}

export function computeLinkUnlinkPass(
  before: unknown,
  after: unknown,
  notNull: boolean,
  isMultiple: boolean
): { hasPass1: boolean; pass1Value?: unknown; skipPass2: boolean } {
  const beforeItems = extractLinkItems(before);
  if (beforeItems.length === 0) {
    return { hasPass1: false, skipPass2: false };
  }
  const afterItems = extractLinkItems(after);
  const afterIds = new Set(afterItems.map((item) => item.id));
  if (!beforeItems.some((item) => !afterIds.has(item.id))) {
    return { hasPass1: false, skipPass2: false };
  }

  const kept = beforeItems.filter((item) => afterIds.has(item.id)).map((item) => item.raw);
  if (kept.length === 0) {
    return notNull
      ? { hasPass1: false, skipPass2: false }
      : { hasPass1: true, pass1Value: null, skipPass2: afterItems.length === 0 };
  }

  return {
    hasPass1: true,
    pass1Value: isMultiple ? kept : kept[0],
    skipPass2: afterItems.length === kept.length,
  };
}

export function isMultipleLinkSnapshot(field: IFieldVcsSnapshot, sampleValue?: unknown): boolean {
  const rel = typeof field.options?.relationship === 'string' ? field.options.relationship : '';
  if (rel === 'oneMany' || rel === 'manyMany') {
    return true;
  }
  if (rel === 'oneOne' || rel === 'manyOne') {
    return false;
  }
  if (field.options?.isMultipleCellValue === true) {
    return true;
  }
  return Array.isArray(sampleValue);
}

export function countPatchRecordOps(patch: IBaseVcsPatch): number {
  let count = 0;
  for (const table of patch.tablesAdded) {
    count += table.records.length;
  }
  for (const tp of patch.tablesUpdated) {
    count += tp.recordsAdded.length + tp.recordsUpdated.length + tp.recordsDeleted.length;
  }
  for (const del of patch.tablesDeleted) {
    count += del.before.records.length;
  }
  return count;
}

function createEmptyTablePatch(tableId: string): ITableVcsPatch {
  return {
    tableId,
    fieldsAdded: [],
    fieldsUpdated: [],
    fieldsDeleted: [],
    viewsAdded: [],
    viewsUpdated: [],
    viewsDeleted: [],
    recordsAdded: [],
    recordsUpdated: [],
    recordsDeleted: [],
  };
}

function isEmptyTablePatch(tp: ITableVcsPatch): boolean {
  return (
    tp.nameChange === undefined &&
    tp.fieldsAdded.length === 0 &&
    tp.fieldsUpdated.length === 0 &&
    tp.fieldsDeleted.length === 0 &&
    tp.viewsAdded.length === 0 &&
    tp.viewsUpdated.length === 0 &&
    tp.viewsDeleted.length === 0 &&
    tp.recordsAdded.length === 0 &&
    tp.recordsUpdated.length === 0 &&
    tp.recordsDeleted.length === 0
  );
}

function packRecordOpsIntoBatches(
  items: ReadonlyArray<{
    readonly tableId: string;
    readonly kind: 'add' | 'update' | 'delete';
    readonly value: unknown;
  }>,
  maxRecordOpsPerBatch: number
): IBaseVcsPatch[] {
  if (items.length === 0) {
    return [];
  }

  const batches: IBaseVcsPatch[] = [];
  let cursor = 0;

  while (cursor < items.length) {
    const slice = items.slice(cursor, cursor + maxRecordOpsPerBatch);
    cursor += slice.length;

    const byTable = new Map<
      string,
      {
        adds: IRecordVcsSnapshot[];
        updates: ITableVcsPatch['recordsUpdated'][number][];
        deletes: ITableVcsPatch['recordsDeleted'][number][];
      }
    >();

    for (const item of slice) {
      let bucket = byTable.get(item.tableId);
      if (!bucket) {
        bucket = { adds: [], updates: [], deletes: [] };
        byTable.set(item.tableId, bucket);
      }
      if (item.kind === 'add') {
        bucket.adds.push(item.value as IRecordVcsSnapshot);
      } else if (item.kind === 'update') {
        bucket.updates.push(item.value as ITableVcsPatch['recordsUpdated'][number]);
      } else {
        bucket.deletes.push(item.value as ITableVcsPatch['recordsDeleted'][number]);
      }
    }

    const tablesUpdated: ITableVcsPatch[] = [];
    for (const [tableId, bucket] of Array.from(byTable.entries()).sort(([a], [b]) =>
      a.localeCompare(b)
    )) {
      tablesUpdated.push({
        ...createEmptyTablePatch(tableId),
        recordsAdded: bucket.adds,
        recordsUpdated: bucket.updates,
        recordsDeleted: bucket.deletes,
      });
    }

    batches.push({
      tablesAdded: [],
      tablesDeleted: [],
      tablesUpdated,
    });
  }

  return batches;
}

function buildEffectiveTableFieldMap(
  patch: IBaseVcsPatch,
  baseFieldsById?: ReadonlyMap<string, readonly IFieldVcsSnapshot[]>
): Map<string, Map<string, IFieldVcsSnapshot>> {
  const result = new Map<string, Map<string, IFieldVcsSnapshot>>();

  if (baseFieldsById) {
    for (const [tableId, fields] of baseFieldsById.entries()) {
      result.set(tableId, new Map(fields.map((f) => [f.id, f])));
    }
  }

  for (const addedTable of patch.tablesAdded) {
    result.set(addedTable.id, new Map(addedTable.fields.map((f) => [f.id, f])));
  }

  for (const tp of patch.tablesUpdated) {
    let fieldMap = result.get(tp.tableId);
    if (!fieldMap) {
      fieldMap = new Map();
      result.set(tp.tableId, fieldMap);
    }
    for (const upd of tp.fieldsUpdated) {
      fieldMap.set(upd.fieldId, upd.after);
    }
    for (const add of tp.fieldsAdded) {
      fieldMap.set(add.id, add);
    }
  }

  return result;
}

function isNonCanonicalSymmetricLinkField(
  tableId: string,
  field: IFieldVcsSnapshot | undefined,
  deletedTableIds: ReadonlySet<string>,
  effectiveFieldsByTable: ReadonlyMap<string, ReadonlyMap<string, IFieldVcsSnapshot>>
): boolean {
  if (!field || field.type !== 'link') {
    return false;
  }
  const symFieldId =
    typeof field.options?.symmetricFieldId === 'string'
      ? field.options.symmetricFieldId
      : undefined;
  const foreignTableId =
    typeof field.options?.foreignTableId === 'string' ? field.options.foreignTableId : undefined;
  if (
    !symFieldId ||
    !foreignTableId ||
    deletedTableIds.has(tableId) ||
    deletedTableIds.has(foreignTableId)
  ) {
    return false;
  }
  const partnerFields = effectiveFieldsByTable.get(foreignTableId);
  if (!partnerFields?.has(symFieldId)) {
    return false;
  }
  return field.id.localeCompare(symFieldId) > 0;
}

function isConstraintTighteningUpdate(upd: ITableVcsPatch['fieldsUpdated'][number]): boolean {
  return (
    (!upd.before.notNull && Boolean(upd.after.notNull)) ||
    (!upd.before.unique && Boolean(upd.after.unique))
  );
}

function buildRecordDeletePayloadForDeletedTable(
  record: IRecordVcsSnapshot,
  fields: readonly IFieldVcsSnapshot[]
): ITableVcsPatch['recordsDeleted'][number] {
  return {
    recordId: record.id,
    before: {
      id: record.id,
      fields: normalizeRecordFields(record.fields, fields),
      version: record.version ?? 1,
      ...(record.autoNumber !== undefined ? { autoNumber: record.autoNumber } : {}),
      ...(record.orders ? { orders: record.orders } : {}),
    },
  };
}

interface IBatchOpQueues {
  readonly scalarAddOps: Array<{ tableId: string; kind: 'add'; value: IRecordVcsSnapshot }>;
  readonly deleteOps: Array<{
    tableId: string;
    kind: 'delete';
    value: ITableVcsPatch['recordsDeleted'][number];
  }>;
  readonly scalarUpdateOps: Array<{
    tableId: string;
    kind: 'update';
    value: ITableVcsPatch['recordsUpdated'][number];
  }>;
  readonly linkUnlinkOps: Array<{
    tableId: string;
    kind: 'update';
    value: ITableVcsPatch['recordsUpdated'][number];
  }>;
  readonly linkFinalOps: Array<{
    tableId: string;
    kind: 'update';
    value: ITableVcsPatch['recordsUpdated'][number];
  }>;
}

function enqueueAddedRecordBatchOps(
  tableId: string,
  addedRecords: readonly IRecordVcsSnapshot[],
  deletedTableIds: ReadonlySet<string>,
  effectiveFieldsByTable: ReadonlyMap<string, ReadonlyMap<string, IFieldVcsSnapshot>>,
  queues: IBatchOpQueues
): void {
  const fieldMap = effectiveFieldsByTable.get(tableId);
  for (const rec of addedRecords) {
    const scalarFields: Record<string, unknown> = {};
    const deferredLinkCells: ICellChangePatch[] = [];

    for (const [fieldId, val] of Object.entries(rec.fields)) {
      const field = fieldMap?.get(fieldId);
      if (field?.type === 'link') {
        if (
          !isNonCanonicalSymmetricLinkField(tableId, field, deletedTableIds, effectiveFieldsByTable)
        ) {
          deferredLinkCells.push({ fieldId, before: null, after: val });
        }
        continue;
      }
      scalarFields[fieldId] = val;
    }

    queues.scalarAddOps.push({ tableId, kind: 'add', value: { ...rec, fields: scalarFields } });
    if (deferredLinkCells.length > 0) {
      queues.linkFinalOps.push({
        tableId,
        kind: 'update',
        value: { recordId: rec.id, cellChanges: deferredLinkCells },
      });
    }
  }
}

function classifyLinkCellForUpdatedBatch(
  tableId: string,
  cell: ICellChangePatch,
  field: IFieldVcsSnapshot,
  deletedTableIds: ReadonlySet<string>,
  effectiveFieldsByTable: ReadonlyMap<string, ReadonlyMap<string, IFieldVcsSnapshot>>,
  unlinkCells: ICellChangePatch[],
  finalLinkCells: ICellChangePatch[]
): void {
  if (isNonCanonicalSymmetricLinkField(tableId, field, deletedTableIds, effectiveFieldsByTable)) {
    return;
  }
  const plan = computeLinkUnlinkPass(
    cell.before,
    cell.after,
    Boolean(field.notNull),
    isMultipleLinkSnapshot(field, cell.before)
  );
  if (!plan.hasPass1) {
    finalLinkCells.push(cell);
    return;
  }
  unlinkCells.push({
    fieldId: cell.fieldId,
    before: cell.before,
    after: plan.pass1Value ?? null,
  });
  if (!plan.skipPass2) {
    finalLinkCells.push({
      fieldId: cell.fieldId,
      before: plan.pass1Value ?? null,
      after: cell.after,
    });
  }
}

function enqueueUpdatedRecordBatchOps(
  tableId: string,
  updRec: ITableVcsPatch['recordsUpdated'][number],
  fieldMap: ReadonlyMap<string, IFieldVcsSnapshot> | undefined,
  deletedTableIds: ReadonlySet<string>,
  effectiveFieldsByTable: ReadonlyMap<string, ReadonlyMap<string, IFieldVcsSnapshot>>,
  queues: IBatchOpQueues
): void {
  const scalarCells: ICellChangePatch[] = [];
  const unlinkCells: ICellChangePatch[] = [];
  const finalLinkCells: ICellChangePatch[] = [];

  for (const cell of updRec.cellChanges) {
    const field = fieldMap?.get(cell.fieldId);
    if (field?.type !== 'link') {
      scalarCells.push(cell);
      continue;
    }
    classifyLinkCellForUpdatedBatch(
      tableId,
      cell,
      field,
      deletedTableIds,
      effectiveFieldsByTable,
      unlinkCells,
      finalLinkCells
    );
  }

  if (scalarCells.length > 0 || updRec.orderChanges?.length) {
    queues.scalarUpdateOps.push({
      tableId,
      kind: 'update',
      value: { ...updRec, cellChanges: scalarCells },
    });
  }
  if (unlinkCells.length > 0) {
    queues.linkUnlinkOps.push({
      tableId,
      kind: 'update',
      value: { recordId: updRec.recordId, cellChanges: unlinkCells },
    });
  }
  if (finalLinkCells.length > 0) {
    queues.linkFinalOps.push({
      tableId,
      kind: 'update',
      value: { recordId: updRec.recordId, cellChanges: finalLinkCells },
    });
  }
}

function processTableUpdateForBatches(
  tp: ITableVcsPatch,
  deletedTableIds: ReadonlySet<string>,
  effectiveFieldsByTable: ReadonlyMap<string, ReadonlyMap<string, IFieldVcsSnapshot>>,
  stage1TablesUpdated: ITableVcsPatch[],
  stage5ConstraintTablesUpdated: ITableVcsPatch[],
  stage6CleanupTablesUpdated: ITableVcsPatch[],
  queues: IBatchOpQueues
): void {
  const tighteningUpdates = tp.fieldsUpdated.filter(isConstraintTighteningUpdate);
  const nonTighteningUpdates = tp.fieldsUpdated.filter((u) => !isConstraintTighteningUpdate(u));

  const stage1Patch: ITableVcsPatch = {
    ...createEmptyTablePatch(tp.tableId),
    ...(tp.nameChange ? { nameChange: tp.nameChange } : {}),
    fieldsAdded: tp.fieldsAdded,
    fieldsUpdated: nonTighteningUpdates,
    viewsAdded: tp.viewsAdded,
    viewsUpdated: tp.viewsUpdated,
    viewsDeleted: tp.viewsDeleted,
  };
  if (!isEmptyTablePatch(stage1Patch)) stage1TablesUpdated.push(stage1Patch);
  if (tighteningUpdates.length > 0) {
    stage5ConstraintTablesUpdated.push({
      ...createEmptyTablePatch(tp.tableId),
      fieldsUpdated: tighteningUpdates,
    });
  }
  if (tp.fieldsDeleted.length > 0) {
    stage6CleanupTablesUpdated.push({
      ...createEmptyTablePatch(tp.tableId),
      fieldsDeleted: tp.fieldsDeleted,
    });
  }

  enqueueAddedRecordBatchOps(
    tp.tableId,
    tp.recordsAdded,
    deletedTableIds,
    effectiveFieldsByTable,
    queues
  );
  for (const delRec of tp.recordsDeleted) {
    queues.deleteOps.push({ tableId: tp.tableId, kind: 'delete', value: delRec });
  }
  const fieldMap = effectiveFieldsByTable.get(tp.tableId);
  for (const updRec of tp.recordsUpdated) {
    enqueueUpdatedRecordBatchOps(
      tp.tableId,
      updRec,
      fieldMap,
      deletedTableIds,
      effectiveFieldsByTable,
      queues
    );
  }
}

export interface IPlanPatchBatchesOptions {
  readonly maxRecordOpsPerBatch?: number;
  readonly tableFieldsById?: ReadonlyMap<string, readonly IFieldVcsSnapshot[]>;
}

export function planPatchBatches(
  patch: IBaseVcsPatch,
  options?: IPlanPatchBatchesOptions
): readonly IBaseVcsPatch[] {
  const maxPerBatch = Math.max(
    1,
    Math.floor(options?.maxRecordOpsPerBatch ?? DEFAULT_MAX_RECORD_OPS_PER_PUSH_BATCH)
  );
  if (countPatchRecordOps(patch) <= maxPerBatch) {
    return [patch];
  }

  const deletedTableIds = new Set(patch.tablesDeleted.map((d) => d.tableId));
  const effectiveFieldsByTable = buildEffectiveTableFieldMap(patch, options?.tableFieldsById);

  const stage1TablesAdded: ITableVcsSnapshot[] = patch.tablesAdded.map((t) => ({
    ...t,
    records: [],
  }));
  const stage1TablesUpdated: ITableVcsPatch[] = [];
  const stage5ConstraintTablesUpdated: ITableVcsPatch[] = [];
  const stage6CleanupTablesUpdated: ITableVcsPatch[] = [];
  const queues: IBatchOpQueues = {
    scalarAddOps: [],
    deleteOps: [],
    scalarUpdateOps: [],
    linkUnlinkOps: [],
    linkFinalOps: [],
  };

  for (const addedTable of patch.tablesAdded) {
    enqueueAddedRecordBatchOps(
      addedTable.id,
      addedTable.records,
      deletedTableIds,
      effectiveFieldsByTable,
      queues
    );
  }
  for (const tp of patch.tablesUpdated) {
    processTableUpdateForBatches(
      tp,
      deletedTableIds,
      effectiveFieldsByTable,
      stage1TablesUpdated,
      stage5ConstraintTablesUpdated,
      stage6CleanupTablesUpdated,
      queues
    );
  }

  const stage6DeletedTables: IDeletedTableVcsPatch[] = patch.tablesDeleted.map((delTable) => {
    for (const rec of delTable.before.records) {
      queues.deleteOps.push({
        tableId: delTable.tableId,
        kind: 'delete',
        value: buildRecordDeletePayloadForDeletedTable(rec, delTable.before.fields),
      });
    }
    return { ...delTable, before: { ...delTable.before, records: [] } };
  });

  const result: IBaseVcsPatch[] = [];
  if (stage1TablesAdded.length > 0 || stage1TablesUpdated.length > 0) {
    result.push({
      tablesAdded: stage1TablesAdded,
      tablesDeleted: [],
      tablesUpdated: stage1TablesUpdated,
    });
  }
  result.push(...packRecordOpsIntoBatches(queues.scalarAddOps, maxPerBatch));
  result.push(...packRecordOpsIntoBatches(queues.deleteOps, maxPerBatch));
  result.push(...packRecordOpsIntoBatches(queues.scalarUpdateOps, maxPerBatch));
  result.push(...packRecordOpsIntoBatches(queues.linkUnlinkOps, maxPerBatch));
  result.push(...packRecordOpsIntoBatches(queues.linkFinalOps, maxPerBatch));
  if (stage5ConstraintTablesUpdated.length > 0) {
    result.push({
      tablesAdded: [],
      tablesDeleted: [],
      tablesUpdated: stage5ConstraintTablesUpdated,
    });
  }
  if (stage6CleanupTablesUpdated.length > 0 || stage6DeletedTables.length > 0) {
    result.push({
      tablesAdded: [],
      tablesDeleted: stage6DeletedTables,
      tablesUpdated: stage6CleanupTablesUpdated,
    });
  }

  return result;
}

function stripDeletedIdsFromLinkValue(value: unknown, deletedIds: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) {
    const kept = value.filter((item) => {
      if (isPlainRecordObject(item) && typeof item.id === 'string') {
        return !deletedIds.has(item.id);
      }
      return true;
    });
    return kept.length > 0 ? kept : null;
  }
  if (isPlainRecordObject(value) && typeof value.id === 'string' && deletedIds.has(value.id)) {
    return null;
  }
  return value;
}

function resolveDeletedForeignIdsForField(
  field: IFieldVcsSnapshot | undefined,
  deletedByTable: ReadonlyMap<string, ReadonlySet<string>>
): ReadonlySet<string> | undefined {
  const foreignTableId =
    field?.type === 'link' && typeof field.options?.foreignTableId === 'string'
      ? field.options.foreignTableId
      : undefined;
  const deletedForeignIds = foreignTableId ? deletedByTable.get(foreignTableId) : undefined;
  return deletedForeignIds && deletedForeignIds.size > 0 ? deletedForeignIds : undefined;
}

function adjustUpdatedRecordForCommittedDeletes(
  recUpd: ITableVcsPatch['recordsUpdated'][number],
  fieldMap: ReadonlyMap<string, IFieldVcsSnapshot>,
  deletedByTable: ReadonlyMap<string, ReadonlySet<string>>
): ITableVcsPatch['recordsUpdated'][number] | undefined {
  const nextCells: ICellChangePatch[] = [];
  for (const cell of recUpd.cellChanges) {
    const deletedForeignIds = resolveDeletedForeignIdsForField(
      fieldMap.get(cell.fieldId),
      deletedByTable
    );
    if (!deletedForeignIds) {
      nextCells.push(cell);
      continue;
    }
    const adjustedBefore = stripDeletedIdsFromLinkValue(cell.before, deletedForeignIds);
    if (!deepEqualVcs(adjustedBefore, cell.after)) {
      nextCells.push({ fieldId: cell.fieldId, before: adjustedBefore, after: cell.after });
    }
  }
  return nextCells.length > 0 || recUpd.orderChanges?.length
    ? { ...recUpd, cellChanges: nextCells }
    : undefined;
}

function adjustDeletedRecordForCommittedDeletes(
  recDel: ITableVcsPatch['recordsDeleted'][number],
  fieldMap: ReadonlyMap<string, IFieldVcsSnapshot>,
  deletedByTable: ReadonlyMap<string, ReadonlySet<string>>
): ITableVcsPatch['recordsDeleted'][number] {
  let changed = false;
  const nextFields = { ...recDel.before.fields };
  for (const [fieldId, val] of Object.entries(nextFields)) {
    const deletedForeignIds = resolveDeletedForeignIdsForField(
      fieldMap.get(fieldId),
      deletedByTable
    );
    if (!deletedForeignIds) continue;
    const adjusted = stripDeletedIdsFromLinkValue(val, deletedForeignIds);
    if (deepEqualVcs(adjusted, val)) continue;
    changed = true;
    if (adjusted === null || adjusted === undefined) {
      delete nextFields[fieldId];
    } else {
      nextFields[fieldId] = adjusted;
    }
  }
  return changed ? { ...recDel, before: { ...recDel.before, fields: nextFields } } : recDel;
}

export function adjustPatchAfterCommittedDeletes(
  patch: IBaseVcsPatch,
  deletedByTable: ReadonlyMap<string, ReadonlySet<string>>,
  tableFieldsById: ReadonlyMap<string, readonly IFieldVcsSnapshot[]>
): IBaseVcsPatch {
  if (deletedByTable.size === 0) {
    return patch;
  }

  const tablesUpdated: ITableVcsPatch[] = [];
  for (const tp of patch.tablesUpdated) {
    const fieldMap = new Map((tableFieldsById.get(tp.tableId) ?? []).map((f) => [f.id, f]));
    const nextUpdated = tp.recordsUpdated
      .map((recUpd) => adjustUpdatedRecordForCommittedDeletes(recUpd, fieldMap, deletedByTable))
      .filter((item): item is ITableVcsPatch['recordsUpdated'][number] => item !== undefined);
    const nextDeleted = tp.recordsDeleted.map((recDel) =>
      adjustDeletedRecordForCommittedDeletes(recDel, fieldMap, deletedByTable)
    );

    const nextTp: ITableVcsPatch = {
      ...tp,
      recordsUpdated: nextUpdated,
      recordsDeleted: nextDeleted,
    };
    if (!isEmptyTablePatch(nextTp)) {
      tablesUpdated.push(nextTp);
    }
  }

  return {
    ...patch,
    tablesUpdated,
  };
}

export function applyTableSchemaPatches(
  existing: ITableVcsSnapshot,
  patch: ITableVcsPatch
): ITableVcsSnapshot {
  const fieldMap = new Map(existing.fields.map((f) => [f.id, cloneVcsValue(f)]));
  for (const deleted of patch.fieldsDeleted) {
    fieldMap.delete(deleted.fieldId);
  }
  for (const updated of patch.fieldsUpdated) {
    fieldMap.set(updated.fieldId, canonicalizeField(cloneVcsValue(updated.after)));
  }
  for (const added of patch.fieldsAdded) {
    fieldMap.set(added.id, canonicalizeField(cloneVcsValue(added)));
  }

  const viewMap = new Map(existing.views.map((v) => [v.id, cloneVcsValue(v)]));
  for (const deleted of patch.viewsDeleted) {
    viewMap.delete(deleted.viewId);
  }
  for (const updated of patch.viewsUpdated) {
    viewMap.set(updated.viewId, canonicalizeView(cloneVcsValue(updated.after)));
  }
  for (const added of patch.viewsAdded) {
    viewMap.set(added.id, canonicalizeView(cloneVcsValue(added)));
  }

  return {
    id: existing.id,
    name: patch.nameChange ? patch.nameChange.to : existing.name,
    ...(existing.dbTableName !== undefined ? { dbTableName: existing.dbTableName } : {}),
    primaryFieldId: existing.primaryFieldId,
    fields: sortFieldsCanonically(Array.from(fieldMap.values())),
    views: sortViewsCanonically(Array.from(viewMap.values())),
    records: [],
  };
}

function buildEffectiveSchemasForBaseline(
  patch: IBaseVcsPatch,
  existingTableSchemas?: ReadonlyMap<string, ITableVcsSnapshot>
): Map<string, ITableVcsSnapshot> {
  const schemas = new Map<string, ITableVcsSnapshot>();
  if (existingTableSchemas) {
    for (const [tableId, table] of existingTableSchemas.entries()) {
      schemas.set(tableId, table);
    }
  }
  for (const added of patch.tablesAdded) {
    schemas.set(added.id, canonicalizeTable({ ...added, records: [] }, { preserveComputed: true }));
  }
  for (const tp of patch.tablesUpdated) {
    const prev = schemas.get(tp.tableId);
    if (prev) {
      schemas.set(tp.tableId, applyTableSchemaPatches(prev, tp));
    }
  }
  return schemas;
}

function getTwoWayLinkMeta(field: IFieldVcsSnapshot | undefined): {
  readonly foreignTableId: string;
  readonly symmetricFieldId: string;
} | null {
  if (!field || field.type !== 'link') {
    return null;
  }
  const foreignTableId =
    typeof field.options?.foreignTableId === 'string' ? field.options.foreignTableId : '';
  const symmetricFieldId =
    typeof field.options?.symmetricFieldId === 'string' ? field.options.symmetricFieldId : '';
  if (!foreignTableId || !symmetricFieldId) {
    return null;
  }
  return { foreignTableId, symmetricFieldId };
}

function addTableRecordIdToSetMap(
  map: Map<string, Set<string>>,
  tableId: string,
  recordId: string
): void {
  let set = map.get(tableId);
  if (!set) {
    set = new Set();
    map.set(tableId, set);
  }
  set.add(recordId);
}

function setMapToArrayMap(map: Map<string, Set<string>>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [tableId, set] of map.entries()) {
    out.set(tableId, Array.from(set));
  }
  return out;
}

function collectTwoWayTargetsFromFields(
  fields: Readonly<Record<string, unknown>>,
  schema: ITableVcsSnapshot | undefined,
  deletedTableIds: ReadonlySet<string>,
  result: Map<string, Set<string>>
): void {
  if (!schema) return;
  for (const [fieldId, val] of Object.entries(fields)) {
    const linkMeta = getTwoWayLinkMeta(schema.fields.find((f) => f.id === fieldId));
    if (!linkMeta || deletedTableIds.has(linkMeta.foreignTableId)) continue;
    for (const item of extractLinkItems(val)) {
      addTableRecordIdToSetMap(result, linkMeta.foreignTableId, item.id);
    }
  }
}

function collectTouchedFromUpdatedRecord(
  tableId: string,
  rUpd: ITableVcsPatch['recordsUpdated'][number],
  fieldById: ReadonlyMap<string, IFieldVcsSnapshot> | undefined,
  deletedTableIds: ReadonlySet<string>,
  result: Map<string, Set<string>>
): void {
  addTableRecordIdToSetMap(result, tableId, rUpd.recordId);
  if (!fieldById) return;
  for (const cell of rUpd.cellChanges) {
    const linkMeta = getTwoWayLinkMeta(fieldById.get(cell.fieldId));
    if (!linkMeta || deletedTableIds.has(linkMeta.foreignTableId)) continue;
    for (const item of extractLinkItems(cell.before)) {
      addTableRecordIdToSetMap(result, linkMeta.foreignTableId, item.id);
    }
    for (const item of extractLinkItems(cell.after)) {
      addTableRecordIdToSetMap(result, linkMeta.foreignTableId, item.id);
    }
  }
}

function collectTouchedFromTableUpdate(
  tp: ITableVcsPatch,
  effectiveSchemas: ReadonlyMap<string, ITableVcsSnapshot> | undefined,
  deletedTableIds: ReadonlySet<string>,
  result: Map<string, Set<string>>
): void {
  const schema = effectiveSchemas?.get(tp.tableId);
  const fieldById = schema ? new Map(schema.fields.map((f) => [f.id, f])) : undefined;

  for (const rAdd of tp.recordsAdded) {
    collectTwoWayTargetsFromFields(rAdd.fields, schema, deletedTableIds, result);
  }
  for (const rUpd of tp.recordsUpdated) {
    collectTouchedFromUpdatedRecord(tp.tableId, rUpd, fieldById, deletedTableIds, result);
  }
  for (const rDel of tp.recordsDeleted) {
    addTableRecordIdToSetMap(result, tp.tableId, rDel.recordId);
    collectTwoWayTargetsFromFields(rDel.before.fields, schema, deletedTableIds, result);
  }
}

export function collectTouchedRecordIdsForBatchMutation(
  patch: IBaseVcsPatch,
  existingTableSchemas?: ReadonlyMap<string, ITableVcsSnapshot>
): Map<string, string[]> {
  const result = new Map<string, Set<string>>();
  const deletedTableIds = new Set(patch.tablesDeleted.map((d) => d.tableId));
  const effectiveSchemas = existingTableSchemas
    ? buildEffectiveSchemasForBaseline(patch, existingTableSchemas)
    : undefined;

  for (const addedTable of patch.tablesAdded) {
    const schema = effectiveSchemas?.get(addedTable.id);
    for (const rec of addedTable.records) {
      collectTwoWayTargetsFromFields(rec.fields, schema, deletedTableIds, result);
    }
  }
  for (const delTable of patch.tablesDeleted) {
    const schema = effectiveSchemas?.get(delTable.tableId);
    for (const rec of delTable.before.records) {
      collectTwoWayTargetsFromFields(rec.fields, schema, deletedTableIds, result);
    }
  }
  for (const tp of patch.tablesUpdated) {
    collectTouchedFromTableUpdate(tp, effectiveSchemas, deletedTableIds, result);
  }

  return setMapToArrayMap(result);
}

function hasNonCanonicalSymmetricFieldInKeys(
  tableId: string,
  fieldIds: Iterable<string>,
  fieldMap: ReadonlyMap<string, IFieldVcsSnapshot>,
  deletedTableIds: ReadonlySet<string>,
  fieldMapsByTable: ReadonlyMap<string, ReadonlyMap<string, IFieldVcsSnapshot>>
): boolean {
  for (const fieldId of fieldIds) {
    if (
      isNonCanonicalSymmetricLinkField(
        tableId,
        fieldMap.get(fieldId),
        deletedTableIds,
        fieldMapsByTable
      )
    ) {
      return true;
    }
  }
  return false;
}

function collectNonCanonicalForTableUpdate(
  tp: ITableVcsPatch,
  fieldMap: ReadonlyMap<string, IFieldVcsSnapshot>,
  deletedTableIds: ReadonlySet<string>,
  fieldMapsByTable: ReadonlyMap<string, ReadonlyMap<string, IFieldVcsSnapshot>>,
  result: Map<string, Set<string>>
): void {
  for (const rec of tp.recordsAdded) {
    if (
      hasNonCanonicalSymmetricFieldInKeys(
        tp.tableId,
        Object.keys(rec.fields),
        fieldMap,
        deletedTableIds,
        fieldMapsByTable
      )
    ) {
      addTableRecordIdToSetMap(result, tp.tableId, rec.id);
    }
  }
  for (const rec of tp.recordsUpdated) {
    if (
      hasNonCanonicalSymmetricFieldInKeys(
        tp.tableId,
        rec.cellChanges.map((c) => c.fieldId),
        fieldMap,
        deletedTableIds,
        fieldMapsByTable
      )
    ) {
      addTableRecordIdToSetMap(result, tp.tableId, rec.recordId);
    }
  }
}

export function collectNonCanonicalSymmetricLinkTargetIds(
  patch: IBaseVcsPatch,
  existingTableSchemas: ReadonlyMap<string, ITableVcsSnapshot>
): Map<string, string[]> {
  const result = new Map<string, Set<string>>();
  const deletedTableIds = new Set(patch.tablesDeleted.map((d) => d.tableId));
  const effectiveSchemas = buildEffectiveSchemasForBaseline(patch, existingTableSchemas);
  const fieldMapsByTable = new Map(
    Array.from(effectiveSchemas.entries()).map(([tid, t]) => [
      tid,
      new Map(t.fields.map((f) => [f.id, f])),
    ])
  );

  for (const added of patch.tablesAdded) {
    const fieldMap = fieldMapsByTable.get(added.id);
    if (!fieldMap) continue;
    for (const rec of added.records) {
      if (
        hasNonCanonicalSymmetricFieldInKeys(
          added.id,
          Object.keys(rec.fields),
          fieldMap,
          deletedTableIds,
          fieldMapsByTable
        )
      ) {
        addTableRecordIdToSetMap(result, added.id, rec.id);
      }
    }
  }

  for (const tp of patch.tablesUpdated) {
    const fieldMap = fieldMapsByTable.get(tp.tableId);
    if (fieldMap) {
      collectNonCanonicalForTableUpdate(tp, fieldMap, deletedTableIds, fieldMapsByTable, result);
    }
  }

  return setMapToArrayMap(result);
}

export function buildNonCanonicalSymmetricLinkSyncBatch(
  fullPatch: IBaseVcsPatch,
  params: {
    readonly existingTableSchemas: ReadonlyMap<string, ITableVcsSnapshot>;
    readonly currentRecordsByTable: ReadonlyMap<string, ReadonlyMap<string, IRecordVcsSnapshot>>;
  }
): {
  readonly recordChanges: ReadonlyArray<{
    readonly tableId: string;
    readonly upserts: readonly IRecordVcsSnapshot[];
    readonly deleteIds: readonly string[];
  }>;
} {
  const deletedTableIds = new Set(fullPatch.tablesDeleted.map((d) => d.tableId));
  const effectiveSchemas = buildEffectiveSchemasForBaseline(fullPatch, params.existingTableSchemas);
  const fieldMapsByTable = new Map(
    Array.from(effectiveSchemas.entries()).map(([tid, t]) => [
      tid,
      new Map(t.fields.map((f) => [f.id, f])),
    ])
  );

  const updatesByTable = new Map<string, Map<string, IRecordVcsSnapshot>>();
  const ensureRecordCopy = (tableId: string, recordId: string): IRecordVcsSnapshot | undefined => {
    let tableUpserts = updatesByTable.get(tableId);
    if (tableUpserts?.has(recordId)) {
      return tableUpserts.get(recordId);
    }
    const existing = params.currentRecordsByTable.get(tableId)?.get(recordId);
    if (!existing) return undefined;
    if (!tableUpserts) {
      tableUpserts = new Map();
      updatesByTable.set(tableId, tableUpserts);
    }
    const copy: IRecordVcsSnapshot = {
      ...existing,
      fields: { ...existing.fields },
    };
    tableUpserts.set(recordId, copy);
    return copy;
  };

  const applyNonCanonicalFields = (
    tableId: string,
    recordId: string,
    cellEntries: ReadonlyArray<readonly [string, unknown]>
  ) => {
    const schema = effectiveSchemas.get(tableId);
    const fieldMap = fieldMapsByTable.get(tableId);
    if (!schema || !fieldMap) return;
    for (const [fieldId, afterVal] of cellEntries) {
      if (
        !isNonCanonicalSymmetricLinkField(
          tableId,
          fieldMap.get(fieldId),
          deletedTableIds,
          fieldMapsByTable
        )
      ) {
        continue;
      }
      const curRec = ensureRecordCopy(tableId, recordId);
      if (!curRec) continue;
      if (deepEqualVcs(curRec.fields[fieldId] ?? null, afterVal ?? null)) continue;
      if (afterVal === null || afterVal === undefined) {
        delete curRec.fields[fieldId];
      } else {
        curRec.fields[fieldId] = cloneVcsValue(afterVal);
      }
    }
  };

  for (const added of fullPatch.tablesAdded) {
    for (const rec of added.records) {
      applyNonCanonicalFields(added.id, rec.id, Object.entries(rec.fields));
    }
  }
  for (const tp of fullPatch.tablesUpdated) {
    for (const rec of tp.recordsAdded) {
      applyNonCanonicalFields(tp.tableId, rec.id, Object.entries(rec.fields));
    }
    for (const rec of tp.recordsUpdated) {
      applyNonCanonicalFields(
        tp.tableId,
        rec.recordId,
        rec.cellChanges.map((c) => [c.fieldId, c.after] as const)
      );
    }
  }

  const recordChanges: Array<{
    readonly tableId: string;
    readonly upserts: readonly IRecordVcsSnapshot[];
    readonly deleteIds: readonly string[];
  }> = [];
  for (const [tableId, tableUpserts] of updatesByTable.entries()) {
    const schema = effectiveSchemas.get(tableId);
    const upserts = Array.from(tableUpserts.values()).map((rec) => ({
      ...rec,
      fields: normalizeRecordFields(rec.fields, schema?.fields),
    }));
    if (upserts.length > 0) {
      recordChanges.push({ tableId, upserts, deleteIds: [] });
    }
  }

  return { recordChanges };
}

function buildReciprocalLinkItem(
  sourceRecordId: string,
  sourceRecordFields: Readonly<Record<string, unknown>> | undefined,
  sourcePrimaryFieldId: string | undefined,
  workingPartnerValue: unknown
): Record<string, unknown> {
  const fromWorking = extractLinkItems(workingPartnerValue).find(
    (item) => item.id === sourceRecordId
  );
  if (fromWorking && isPlainRecordObject(fromWorking.raw)) {
    return cloneVcsValue(fromWorking.raw);
  }
  if (sourcePrimaryFieldId && sourceRecordFields) {
    const rawTitle = sourceRecordFields[sourcePrimaryFieldId];
    if (typeof rawTitle === 'string' && rawTitle.length > 0) {
      return { id: sourceRecordId, title: rawTitle };
    }
  }
  return { id: sourceRecordId };
}

interface IBaselineMutationState {
  readonly deletedTableIds: ReadonlySet<string>;
  readonly tablesAddedById: ReadonlyMap<string, Map<string, IRecordVcsSnapshot>>;
  readonly existingTableSchemas: ReadonlyMap<string, ITableVcsSnapshot>;
  readonly effectiveSchemas: ReadonlyMap<string, ITableVcsSnapshot>;
  readonly existingBaseRecordsByTable?: ReadonlyMap<
    string,
    ReadonlyMap<string, IRecordVcsSnapshot>
  >;
  readonly workingRecordsByTable?: ReadonlyMap<string, ReadonlyMap<string, IRecordVcsSnapshot>>;
  readonly tablesSchemaUpdated: ITableVcsSnapshot[];
  readonly pendingUpsertsByTable: Map<string, Map<string, IRecordVcsSnapshot>>;
  readonly deleteIdsByTable: Map<string, Set<string>>;
  readonly explicitCellUpdates: Set<string>;
  readonly sourceRecordFieldsCache: Map<string, Readonly<Record<string, unknown>>>;
}

function getOrCreateMapEntry<K, V>(outer: Map<K, V>, key: K, create: () => V): V {
  let val = outer.get(key);
  if (!val) {
    val = create();
    outer.set(key, val);
  }
  return val;
}

function tablePatchHasSchemaChange(tp: ITableVcsPatch): boolean {
  return (
    tp.nameChange !== undefined ||
    tp.fieldsAdded.length > 0 ||
    tp.fieldsUpdated.length > 0 ||
    tp.fieldsDeleted.length > 0 ||
    tp.viewsAdded.length > 0 ||
    tp.viewsUpdated.length > 0 ||
    tp.viewsDeleted.length > 0
  );
}

function applyBaselineRecordAdd(
  tableId: string,
  rAdd: IRecordVcsSnapshot,
  nextFields: readonly IFieldVcsSnapshot[] | undefined,
  upsertMap: Map<string, IRecordVcsSnapshot>,
  state: IBaselineMutationState
): void {
  const normalized = normalizeRecordFields(rAdd.fields, nextFields);
  upsertMap.set(rAdd.id, {
    ...rAdd,
    fields: normalized,
    version: rAdd.version ?? 1,
  });
  state.sourceRecordFieldsCache.set(`${tableId}:${rAdd.id}`, normalized);
  for (const fieldId of Object.keys(normalized)) {
    state.explicitCellUpdates.add(`${tableId}:${rAdd.id}:${fieldId}`);
  }
}

function applyBaselineRecordUpdate(
  tableId: string,
  rUpd: ITableVcsPatch['recordsUpdated'][number],
  prevRec: IRecordVcsSnapshot | undefined,
  nextFields: readonly IFieldVcsSnapshot[] | undefined,
  upsertMap: Map<string, IRecordVcsSnapshot>,
  state: IBaselineMutationState
): void {
  const nextFieldsObj: Record<string, unknown> = prevRec ? { ...prevRec.fields } : {};
  for (const cell of rUpd.cellChanges) {
    state.explicitCellUpdates.add(`${tableId}:${rUpd.recordId}:${cell.fieldId}`);
    if (cell.after === null || cell.after === undefined) {
      delete nextFieldsObj[cell.fieldId];
    } else {
      nextFieldsObj[cell.fieldId] = cloneVcsValue(cell.after);
    }
  }
  const normalized = normalizeRecordFields(nextFieldsObj, nextFields);
  upsertMap.set(rUpd.recordId, {
    ...prevRec,
    id: rUpd.recordId,
    fields: normalized,
    version: (prevRec?.version ?? 0) + 1,
    ...(rUpd.orderChanges?.length && {
      orders: {
        ...prevRec?.orders,
        ...Object.fromEntries(rUpd.orderChanges.map(({ viewId, after }) => [viewId, after])),
      },
    }),
  });
  state.sourceRecordFieldsCache.set(`${tableId}:${rUpd.recordId}`, normalized);
}

function applyBaselineTableUpdate(tp: ITableVcsPatch, state: IBaselineMutationState): void {
  let nextFields: readonly IFieldVcsSnapshot[] | undefined = state.existingTableSchemas.get(
    tp.tableId
  )?.fields;
  if (tablePatchHasSchemaChange(tp)) {
    const prevSchema = state.existingTableSchemas.get(tp.tableId);
    if (prevSchema) {
      const updatedSchema = applyTableSchemaPatches(prevSchema, tp);
      state.tablesSchemaUpdated.push(updatedSchema);
      nextFields = updatedSchema.fields;
    }
  }

  const existingRecords = state.existingBaseRecordsByTable?.get(tp.tableId);
  const upsertMap = getOrCreateMapEntry(state.pendingUpsertsByTable, tp.tableId, () => new Map());
  const deleteSet = getOrCreateMapEntry(state.deleteIdsByTable, tp.tableId, () => new Set());

  for (const rAdd of tp.recordsAdded) {
    applyBaselineRecordAdd(tp.tableId, rAdd, nextFields, upsertMap, state);
  }
  for (const rUpd of tp.recordsUpdated) {
    applyBaselineRecordUpdate(
      tp.tableId,
      rUpd,
      existingRecords?.get(rUpd.recordId),
      nextFields,
      upsertMap,
      state
    );
  }
  for (const d of tp.recordsDeleted) {
    deleteSet.add(d.recordId);
    upsertMap.delete(d.recordId);
    state.sourceRecordFieldsCache.set(`${tp.tableId}:${d.recordId}`, d.before.fields);
  }
}

function resolveOrClonePartnerRecord(
  foreignTableId: string,
  targetRecordId: string,
  state: IBaselineMutationState
): IRecordVcsSnapshot | undefined {
  const existing =
    state.tablesAddedById.get(foreignTableId)?.get(targetRecordId) ??
    state.pendingUpsertsByTable.get(foreignTableId)?.get(targetRecordId);
  if (existing) return existing;

  const basePartnerRec = state.existingBaseRecordsByTable?.get(foreignTableId)?.get(targetRecordId);
  if (!basePartnerRec) return undefined;

  const cloned: IRecordVcsSnapshot = {
    ...basePartnerRec,
    fields: { ...basePartnerRec.fields },
  };
  getOrCreateMapEntry(state.pendingUpsertsByTable, foreignTableId, () => new Map()).set(
    targetRecordId,
    cloned
  );
  return cloned;
}

function updateSinglePartnerSymmetricField(params: {
  readonly state: IBaselineMutationState;
  readonly sourceRecordId: string;
  readonly sourceFields: Readonly<Record<string, unknown>> | undefined;
  readonly sourcePrimaryFieldId: string | undefined;
  readonly foreignTableId: string;
  readonly symmetricFieldId: string;
  readonly targetRecordId: string;
  readonly isPartnerMultiple: boolean;
  readonly afterIds: ReadonlySet<string>;
  readonly beforeIds: ReadonlySet<string>;
}): void {
  const { state, targetRecordId, foreignTableId, symmetricFieldId } = params;
  if (state.deleteIdsByTable.get(foreignTableId)?.has(targetRecordId)) return;
  if (state.explicitCellUpdates.has(`${foreignTableId}:${targetRecordId}:${symmetricFieldId}`))
    return;

  const partnerRec = resolveOrClonePartnerRecord(foreignTableId, targetRecordId, state);
  if (!partnerRec) return;

  const existingItems = extractLinkItems(partnerRec.fields[symmetricFieldId]);
  const shouldAdd = params.afterIds.has(targetRecordId);
  let nextItems = existingItems.map((item) => item.raw);

  if (shouldAdd) {
    const workingPartnerVal = state.workingRecordsByTable?.get(foreignTableId)?.get(targetRecordId)
      ?.fields[symmetricFieldId];
    const newItem = buildReciprocalLinkItem(
      params.sourceRecordId,
      params.sourceFields,
      params.sourcePrimaryFieldId,
      workingPartnerVal
    );
    if (params.isPartnerMultiple) {
      if (!existingItems.some((item) => item.id === params.sourceRecordId)) {
        nextItems = [...nextItems, newItem];
      }
    } else {
      nextItems = [newItem];
    }
  } else if (params.beforeIds.has(targetRecordId)) {
    nextItems = existingItems
      .filter((item) => item.id !== params.sourceRecordId)
      .map((item) => item.raw);
  }

  const nextPartnerFields = { ...partnerRec.fields };
  if (nextItems.length === 0) {
    delete nextPartnerFields[symmetricFieldId];
  } else {
    nextPartnerFields[symmetricFieldId] = params.isPartnerMultiple ? nextItems : nextItems[0];
  }
  (partnerRec as { fields: Record<string, unknown> }).fields = nextPartnerFields;
}

function applyReciprocalLinkDeltaForCell(
  state: IBaselineMutationState,
  sourceTableId: string,
  sourceRecordId: string,
  sourceField: IFieldVcsSnapshot,
  beforeVal: unknown,
  afterVal: unknown
): void {
  const linkMeta = getTwoWayLinkMeta(sourceField);
  if (!linkMeta || state.deletedTableIds.has(linkMeta.foreignTableId)) return;
  const partnerField = state.effectiveSchemas
    .get(linkMeta.foreignTableId)
    ?.fields.find((f) => f.id === linkMeta.symmetricFieldId);
  if (!partnerField || partnerField.type !== 'link') return;

  const beforeIds = new Set(extractLinkItems(beforeVal).map((item) => item.id));
  const afterIds = new Set(extractLinkItems(afterVal).map((item) => item.id));
  const touchedTargetIds = new Set<string>();
  for (const id of beforeIds) {
    if (!afterIds.has(id)) touchedTargetIds.add(id);
  }
  for (const id of afterIds) {
    if (!beforeIds.has(id)) touchedTargetIds.add(id);
  }
  if (touchedTargetIds.size === 0) return;

  const sourceFields =
    state.workingRecordsByTable?.get(sourceTableId)?.get(sourceRecordId)?.fields ??
    state.sourceRecordFieldsCache.get(`${sourceTableId}:${sourceRecordId}`) ??
    state.existingBaseRecordsByTable?.get(sourceTableId)?.get(sourceRecordId)?.fields;
  const sourcePrimaryFieldId = state.effectiveSchemas.get(sourceTableId)?.primaryFieldId;
  const isPartnerMultiple = isMultipleLinkSnapshot(partnerField);

  for (const targetRecordId of touchedTargetIds) {
    updateSinglePartnerSymmetricField({
      state,
      sourceRecordId,
      sourceFields,
      sourcePrimaryFieldId,
      foreignTableId: linkMeta.foreignTableId,
      symmetricFieldId: linkMeta.symmetricFieldId,
      targetRecordId,
      isPartnerMultiple,
      afterIds,
      beforeIds,
    });
  }
}

function propagateReciprocalFromRecordSnapshot(
  state: IBaselineMutationState,
  tableId: string,
  schema: ITableVcsSnapshot,
  records: readonly IRecordVcsSnapshot[],
  mode: 'add' | 'delete'
): void {
  const fieldById = new Map(schema.fields.map((f) => [f.id, f]));
  for (const rec of records) {
    for (const [fieldId, val] of Object.entries(rec.fields)) {
      const field = fieldById.get(fieldId);
      if (field?.type === 'link') {
        applyReciprocalLinkDeltaForCell(
          state,
          tableId,
          rec.id,
          field,
          mode === 'delete' ? val : null,
          mode === 'add' ? val : null
        );
      }
    }
  }
}

function propagateTableUpdateReciprocalLinks(
  tp: ITableVcsPatch,
  state: IBaselineMutationState
): void {
  const schema = state.effectiveSchemas.get(tp.tableId);
  if (!schema) return;
  const fieldById = new Map(schema.fields.map((f) => [f.id, f]));
  propagateReciprocalFromRecordSnapshot(state, tp.tableId, schema, tp.recordsAdded, 'add');
  for (const rUpd of tp.recordsUpdated) {
    for (const cell of rUpd.cellChanges) {
      const field = fieldById.get(cell.fieldId);
      if (field?.type === 'link') {
        applyReciprocalLinkDeltaForCell(
          state,
          tp.tableId,
          rUpd.recordId,
          field,
          cell.before,
          cell.after
        );
      }
    }
  }
  for (const rDel of tp.recordsDeleted) {
    propagateReciprocalFromRecordSnapshot(state, tp.tableId, schema, [rDel.before], 'delete');
  }
}

function propagateAllReciprocalLinks(patch: IBaseVcsPatch, state: IBaselineMutationState): void {
  for (const addedTable of patch.tablesAdded) {
    const schema = state.effectiveSchemas.get(addedTable.id);
    if (schema) {
      propagateReciprocalFromRecordSnapshot(
        state,
        addedTable.id,
        schema,
        addedTable.records,
        'add'
      );
    }
  }
  for (const delTable of patch.tablesDeleted) {
    propagateReciprocalFromRecordSnapshot(
      state,
      delTable.tableId,
      delTable.before,
      delTable.before.records,
      'delete'
    );
  }
  for (const tp of patch.tablesUpdated) {
    propagateTableUpdateReciprocalLinks(tp, state);
  }
}

function buildBaselineRecordChanges(state: IBaselineMutationState): Array<{
  readonly tableId: string;
  readonly upserts: readonly IRecordVcsSnapshot[];
  readonly deleteIds: readonly string[];
}> {
  const recordChanges: Array<{
    readonly tableId: string;
    readonly upserts: readonly IRecordVcsSnapshot[];
    readonly deleteIds: readonly string[];
  }> = [];
  const allChangedTableIds = new Set<string>([
    ...state.pendingUpsertsByTable.keys(),
    ...state.deleteIdsByTable.keys(),
  ]);
  for (const tableId of Array.from(allChangedTableIds).sort()) {
    if (state.tablesAddedById.has(tableId) || state.deletedTableIds.has(tableId)) continue;
    const schema = state.effectiveSchemas.get(tableId);
    const upserts = Array.from(state.pendingUpsertsByTable.get(tableId)?.values() ?? []).map(
      (rec) => ({
        ...rec,
        fields: normalizeRecordFields(rec.fields, schema?.fields),
      })
    );
    const deleteIds = Array.from(state.deleteIdsByTable.get(tableId) ?? []);
    if (upserts.length > 0 || deleteIds.length > 0) {
      recordChanges.push({ tableId, upserts, deleteIds });
    }
  }
  return recordChanges;
}

export function patchToBaselineMutationBatch(
  patch: IBaseVcsPatch,
  params: {
    readonly newRevision: number;
    readonly cursor?: string;
    readonly baseName?: string;
    readonly accessScope?: IBaseVcsAccessScope;
    readonly existingTableSchemas: ReadonlyMap<string, ITableVcsSnapshot>;
    readonly existingBaseRecordsByTable?: ReadonlyMap<
      string,
      ReadonlyMap<string, IRecordVcsSnapshot>
    >;
    readonly workingRecordsByTable?: ReadonlyMap<string, ReadonlyMap<string, IRecordVcsSnapshot>>;
  }
): {
  readonly revision: number;
  readonly cursor?: string;
  readonly baseName?: string;
  readonly accessScope?: IBaseVcsAccessScope;
  readonly tablesAdded: readonly ITableVcsSnapshot[];
  readonly tablesDeleted: readonly string[];
  readonly tablesSchemaUpdated: readonly ITableVcsSnapshot[];
  readonly recordChanges: ReadonlyArray<{
    readonly tableId: string;
    readonly upserts: readonly IRecordVcsSnapshot[];
    readonly deleteIds: readonly string[];
  }>;
} {
  const tablesAdded = patch.tablesAdded.map((t) => {
    const canonical = canonicalizeTable(t, { preserveComputed: true });
    return {
      ...canonical,
      records: canonical.records.map((r) => ({ ...r, version: r.version ?? 1 })),
    };
  });
  const state: IBaselineMutationState = {
    deletedTableIds: new Set(patch.tablesDeleted.map((d) => d.tableId)),
    tablesAddedById: new Map(
      tablesAdded.map((t) => [t.id, new Map(t.records.map((r) => [r.id, r]))])
    ),
    existingTableSchemas: params.existingTableSchemas,
    effectiveSchemas: buildEffectiveSchemasForBaseline(patch, params.existingTableSchemas),
    existingBaseRecordsByTable: params.existingBaseRecordsByTable,
    workingRecordsByTable: params.workingRecordsByTable,
    tablesSchemaUpdated: [],
    pendingUpsertsByTable: new Map(),
    deleteIdsByTable: new Map(),
    explicitCellUpdates: new Set(),
    sourceRecordFieldsCache: new Map(),
  };

  for (const tp of patch.tablesUpdated) {
    applyBaselineTableUpdate(tp, state);
  }
  propagateAllReciprocalLinks(patch, state);

  return {
    revision: params.newRevision,
    ...(params.cursor !== undefined ? { cursor: params.cursor } : {}),
    ...(params.baseName !== undefined ? { baseName: params.baseName } : {}),
    ...(params.accessScope !== undefined ? { accessScope: params.accessScope } : {}),
    tablesAdded,
    tablesDeleted: patch.tablesDeleted.map((d) => d.tableId),
    tablesSchemaUpdated: state.tablesSchemaUpdated,
    recordChanges: buildBaselineRecordChanges(state),
  };
}
