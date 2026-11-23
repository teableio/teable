import {
  canonicalizeField,
  canonicalizeRecord,
  canonicalizeTable,
  canonicalizeValue,
  canonicalizeView,
  deepEqualVcs,
  isStoredVcsField,
  normalizeRecordFields,
  sortFieldsCanonically,
  sortRecordsCanonically,
  sortTablesCanonically,
  sortViewsCanonically,
} from './fieldClassification';
import type {
  IBaseVcsAccessScope,
  IBaseVcsPatch,
  IBaseVcsPatchSummary,
  IBaseVcsSnapshot,
  ICellChangePatch,
  IComputedImpactCellChange,
  IComputedImpactReport,
  IFieldVcsSnapshot,
  IRecordVcsSnapshot,
  ITableAccessScope,
  ITableVcsPatch,
  ITableVcsSnapshot,
  IViewVcsSnapshot,
} from './types';

function cleanOptions(
  options: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!options) {
    return undefined;
  }
  const canonical = canonicalizeValue(options) as Record<string, unknown>;
  return Object.keys(canonical).length > 0 ? canonical : undefined;
}

function normalizeComparableField(field: IFieldVcsSnapshot): Record<string, unknown> {
  return {
    id: field.id,
    name: field.name,
    type: field.type,
    options: cleanOptions(field.options) ?? null,
    notNull: Boolean(field.notNull),
    unique: Boolean(field.unique),
    description: field.description ?? null,
    aiConfig: field.aiConfig !== undefined ? canonicalizeValue(field.aiConfig) : null,
    isLookup: Boolean(field.isLookup),
    isConditionalLookup: Boolean(field.isConditionalLookup),
    isPrimary: field.isPrimary,
    isComputed: field.isComputed,
  };
}

function normalizeComparableView(view: IViewVcsSnapshot): Record<string, unknown> {
  const query = view.query
    ? {
        filter: view.query.filter !== undefined ? canonicalizeValue(view.query.filter) : null,
        sort: view.query.sort !== undefined ? canonicalizeValue(view.query.sort) : null,
        group: view.query.group !== undefined ? canonicalizeValue(view.query.group) : null,
        manualSort: Boolean(view.query.manualSort),
      }
    : { filter: null, sort: null, group: null, manualSort: false };

  return {
    id: view.id,
    name: view.name,
    type: view.type,
    description: view.description ?? null,
    columnMeta: cleanOptions(view.columnMeta) ?? null,
    options: cleanOptions(view.options) ?? null,
    query,
    order: view.order ?? null,
  };
}

function diffTableFields(
  beforeFields: readonly IFieldVcsSnapshot[],
  afterFields: readonly IFieldVcsSnapshot[],
  readableFieldIds: Set<string> | undefined
): Pick<ITableVcsPatch, 'fieldsAdded' | 'fieldsUpdated' | 'fieldsDeleted'> {
  const beforeMap = new Map(beforeFields.map((f) => [f.id, f]));
  const afterMap = new Map(afterFields.map((f) => [f.id, f]));

  const fieldsAdded: IFieldVcsSnapshot[] = [];
  const fieldsUpdated: ITableVcsPatch['fieldsUpdated'][number][] = [];
  const fieldsDeleted: ITableVcsPatch['fieldsDeleted'][number][] = [];

  for (const afterField of sortFieldsCanonically(afterFields)) {
    const beforeField = beforeMap.get(afterField.id);
    if (!beforeField) {
      fieldsAdded.push(canonicalizeField(afterField));
      continue;
    }
    if (
      !deepEqualVcs(normalizeComparableField(beforeField), normalizeComparableField(afterField))
    ) {
      fieldsUpdated.push({
        fieldId: afterField.id,
        before: canonicalizeField(beforeField),
        after: canonicalizeField(afterField),
      });
    }
  }

  for (const beforeField of sortFieldsCanonically(beforeFields)) {
    if (afterMap.has(beforeField.id)) {
      continue;
    }
    if (readableFieldIds && !readableFieldIds.has(beforeField.id)) {
      continue;
    }
    fieldsDeleted.push({
      fieldId: beforeField.id,
      before: canonicalizeField(beforeField),
    });
  }

  return { fieldsAdded, fieldsUpdated, fieldsDeleted };
}

function diffTableViews(
  beforeViews: readonly IViewVcsSnapshot[],
  afterViews: readonly IViewVcsSnapshot[]
): Pick<ITableVcsPatch, 'viewsAdded' | 'viewsUpdated' | 'viewsDeleted'> {
  const beforeMap = new Map(beforeViews.map((v) => [v.id, v]));
  const afterMap = new Map(afterViews.map((v) => [v.id, v]));

  const viewsAdded: IViewVcsSnapshot[] = [];
  const viewsUpdated: ITableVcsPatch['viewsUpdated'][number][] = [];
  const viewsDeleted: ITableVcsPatch['viewsDeleted'][number][] = [];

  for (const afterView of sortViewsCanonically(afterViews)) {
    const beforeView = beforeMap.get(afterView.id);
    if (!beforeView) {
      viewsAdded.push(canonicalizeView(afterView));
      continue;
    }
    if (!deepEqualVcs(normalizeComparableView(beforeView), normalizeComparableView(afterView))) {
      viewsUpdated.push({
        viewId: afterView.id,
        before: canonicalizeView(beforeView),
        after: canonicalizeView(afterView),
      });
    }
  }

  for (const beforeView of sortViewsCanonically(beforeViews)) {
    if (!afterMap.has(beforeView.id)) {
      viewsDeleted.push({
        viewId: beforeView.id,
        before: canonicalizeView(beforeView),
      });
    }
  }

  return { viewsAdded, viewsUpdated, viewsDeleted };
}

function diffRecordCells(
  beforeFields: Readonly<Record<string, unknown>>,
  afterFields: Readonly<Record<string, unknown>>,
  activeStoredFieldIds: Set<string>,
  readableFieldIds: Set<string> | undefined
): ICellChangePatch[] {
  const fieldIds = new Set<string>();
  for (const key of Object.keys(beforeFields)) {
    if (activeStoredFieldIds.has(key) && (!readableFieldIds || readableFieldIds.has(key))) {
      fieldIds.add(key);
    }
  }
  for (const key of Object.keys(afterFields)) {
    if (!readableFieldIds || readableFieldIds.has(key)) {
      fieldIds.add(key);
    }
  }

  const changes: ICellChangePatch[] = [];
  for (const fieldId of Array.from(fieldIds).sort()) {
    const beforeVal = beforeFields[fieldId] ?? null;
    const afterVal = afterFields[fieldId] ?? null;
    if (!deepEqualVcs(beforeVal, afterVal)) {
      changes.push({
        fieldId,
        before: beforeVal,
        after: afterVal,
      });
    }
  }
  return changes;
}

function diffTableRecords(
  beforeTable: ITableVcsSnapshot,
  afterTable: ITableVcsSnapshot,
  tableScope: ITableAccessScope | undefined,
  readableFieldIds: Set<string> | undefined
): Pick<ITableVcsPatch, 'recordsAdded' | 'recordsUpdated' | 'recordsDeleted'> {
  const beforeMap = new Map(beforeTable.records.map((r) => [r.id, r]));
  const afterMap = new Map(afterTable.records.map((r) => [r.id, r]));

  const activeStoredFieldIds = new Set<string>(
    afterTable.fields.filter(isStoredVcsField).map((f) => f.id)
  );

  const recordsAdded: IRecordVcsSnapshot[] = [];
  const recordsUpdated: ITableVcsPatch['recordsUpdated'][number][] = [];
  const recordsDeleted: ITableVcsPatch['recordsDeleted'][number][] = [];

  for (const afterRec of sortRecordsCanonically(afterTable.records, afterTable.fields)) {
    const beforeRec = beforeMap.get(afterRec.id);
    const normalizedAfter = normalizeRecordFields(afterRec.fields, afterTable.fields);

    if (!beforeRec) {
      recordsAdded.push({
        id: afterRec.id,
        fields: normalizedAfter,
        ...(afterRec.orders ? { orders: afterRec.orders } : {}),
      });
      continue;
    }

    const normalizedBefore = normalizeRecordFields(beforeRec.fields, beforeTable.fields);
    const cellChanges = diffRecordCells(
      normalizedBefore,
      normalizedAfter,
      activeStoredFieldIds,
      readableFieldIds
    );
    if (cellChanges.length > 0) {
      recordsUpdated.push({
        recordId: afterRec.id,
        cellChanges,
      });
    }
  }

  if (!tableScope?.isRowFiltered) {
    for (const beforeRec of sortRecordsCanonically(beforeTable.records, beforeTable.fields)) {
      if (!afterMap.has(beforeRec.id)) {
        recordsDeleted.push({
          recordId: beforeRec.id,
          before: {
            ...canonicalizeRecord(beforeRec, beforeTable.fields),
            version: beforeRec.version ?? 1,
          },
        });
      }
    }
  }

  return { recordsAdded, recordsUpdated, recordsDeleted };
}

function hasTablePatchChanges(patch: ITableVcsPatch): boolean {
  return (
    patch.nameChange !== undefined ||
    patch.fieldsAdded.length > 0 ||
    patch.fieldsUpdated.length > 0 ||
    patch.fieldsDeleted.length > 0 ||
    patch.viewsAdded.length > 0 ||
    patch.viewsUpdated.length > 0 ||
    patch.viewsDeleted.length > 0 ||
    patch.recordsAdded.length > 0 ||
    patch.recordsUpdated.length > 0 ||
    patch.recordsDeleted.length > 0
  );
}

function diffTable(
  beforeTable: ITableVcsSnapshot,
  afterTable: ITableVcsSnapshot,
  tableScope: ITableAccessScope | undefined
): ITableVcsPatch | undefined {
  const readableFieldIds = tableScope?.readableFieldIds
    ? new Set(tableScope.readableFieldIds)
    : undefined;

  const fieldDiff = diffTableFields(beforeTable.fields, afterTable.fields, readableFieldIds);
  const viewDiff = diffTableViews(beforeTable.views, afterTable.views);
  const recordDiff = diffTableRecords(beforeTable, afterTable, tableScope, readableFieldIds);

  const patch: ITableVcsPatch = {
    tableId: afterTable.id,
    ...(beforeTable.name !== afterTable.name
      ? { nameChange: { from: beforeTable.name, to: afterTable.name } }
      : {}),
    ...fieldDiff,
    ...viewDiff,
    ...recordDiff,
  };

  return hasTablePatchChanges(patch) ? patch : undefined;
}

export function diffSnapshots(
  before: IBaseVcsSnapshot,
  after: IBaseVcsSnapshot,
  options?: { accessScope?: IBaseVcsAccessScope }
): IBaseVcsPatch {
  const accessScope = options?.accessScope ?? after.accessScope ?? before.accessScope;
  const beforeMap = new Map(before.tables.map((t) => [t.id, t]));
  const afterMap = new Map(after.tables.map((t) => [t.id, t]));

  const tablesAdded: ITableVcsSnapshot[] = [];
  const tablesDeleted: IBaseVcsPatch['tablesDeleted'][number][] = [];
  const tablesUpdated: ITableVcsPatch[] = [];

  for (const afterTable of sortTablesCanonically(after.tables)) {
    const beforeTable = beforeMap.get(afterTable.id);
    if (!beforeTable) {
      tablesAdded.push(canonicalizeTable(afterTable));
      continue;
    }
    const tablePatch = diffTable(beforeTable, afterTable, accessScope?.tables[afterTable.id]);
    if (tablePatch) {
      tablesUpdated.push(tablePatch);
    }
  }

  for (const beforeTable of sortTablesCanonically(before.tables)) {
    if (!afterMap.has(beforeTable.id)) {
      tablesDeleted.push({
        tableId: beforeTable.id,
        tableName: beforeTable.name,
        before: canonicalizeTable(beforeTable),
      });
    }
  }

  return {
    tablesAdded,
    tablesDeleted,
    tablesUpdated,
  };
}

export function isEmptyPatch(patch: IBaseVcsPatch): boolean {
  return (
    patch.tablesAdded.length === 0 &&
    patch.tablesDeleted.length === 0 &&
    patch.tablesUpdated.every((t) => !hasTablePatchChanges(t))
  );
}

export function summarizePatch(patch: IBaseVcsPatch): IBaseVcsPatchSummary {
  let tablesRenamed = 0;
  let fieldsAdded = 0;
  let fieldsUpdated = 0;
  let fieldsDeleted = 0;
  let viewsAdded = 0;
  let viewsUpdated = 0;
  let viewsDeleted = 0;
  let recordsAdded = 0;
  let recordsUpdated = 0;
  let recordsDeleted = 0;
  let cellChanges = 0;

  for (const table of patch.tablesUpdated) {
    if (table.nameChange) tablesRenamed += 1;
    fieldsAdded += table.fieldsAdded.length;
    fieldsUpdated += table.fieldsUpdated.length;
    fieldsDeleted += table.fieldsDeleted.length;
    viewsAdded += table.viewsAdded.length;
    viewsUpdated += table.viewsUpdated.length;
    viewsDeleted += table.viewsDeleted.length;
    recordsAdded += table.recordsAdded.length;
    recordsUpdated += table.recordsUpdated.length;
    recordsDeleted += table.recordsDeleted.length;
    for (const rec of table.recordsUpdated) {
      cellChanges += rec.cellChanges.length;
    }
  }

  return {
    tablesAdded: patch.tablesAdded.length,
    tablesDeleted: patch.tablesDeleted.length,
    tablesRenamed,
    fieldsAdded,
    fieldsUpdated,
    fieldsDeleted,
    viewsAdded,
    viewsUpdated,
    viewsDeleted,
    recordsAdded,
    recordsUpdated,
    recordsDeleted,
    cellChanges,
  };
}

function collectComputedFieldsForImpact(
  beforeTable: ITableVcsSnapshot,
  afterTable: ITableVcsSnapshot
): Map<string, IFieldVcsSnapshot> {
  const computedFieldsMap = new Map<string, IFieldVcsSnapshot>();
  for (const f of beforeTable.fields) {
    if (!isStoredVcsField(f)) {
      computedFieldsMap.set(f.id, f);
    }
  }
  for (const f of afterTable.fields) {
    if (!isStoredVcsField(f)) {
      computedFieldsMap.set(f.id, f);
    } else {
      computedFieldsMap.delete(f.id);
    }
  }
  return computedFieldsMap;
}

function collectRecordComputedImpact(
  afterTable: ITableVcsSnapshot,
  beforeRecord: IRecordVcsSnapshot,
  afterRecord: IRecordVcsSnapshot,
  computedFieldIds: readonly string[],
  computedFieldsMap: ReadonlyMap<string, IFieldVcsSnapshot>,
  changes: IComputedImpactCellChange[]
): void {
  for (const fieldId of computedFieldIds) {
    const beforeVal = beforeRecord.fields[fieldId] ?? null;
    const afterVal = afterRecord.fields[fieldId] ?? null;
    if (!deepEqualVcs(beforeVal, afterVal)) {
      const fieldMeta = computedFieldsMap.get(fieldId);
      changes.push({
        tableId: afterTable.id,
        tableName: afterTable.name,
        recordId: afterRecord.id,
        fieldId,
        fieldName: fieldMeta?.name ?? fieldId,
        before: beforeVal,
        after: afterVal,
      });
    }
  }
}

export function diffComputedImpact(
  beforeEngineSnapshot: IBaseVcsSnapshot,
  afterEngineSnapshot: IBaseVcsSnapshot
): IComputedImpactReport {
  const beforeTableMap = new Map(beforeEngineSnapshot.tables.map((t) => [t.id, t]));
  const changes: IComputedImpactCellChange[] = [];

  for (const afterTable of [...afterEngineSnapshot.tables].sort((a, b) =>
    a.id.localeCompare(b.id)
  )) {
    const beforeTable = beforeTableMap.get(afterTable.id);
    if (!beforeTable) {
      continue;
    }

    const computedFieldsMap = collectComputedFieldsForImpact(beforeTable, afterTable);
    if (computedFieldsMap.size === 0) {
      continue;
    }

    const beforeRecords = new Map(beforeTable.records.map((r) => [r.id, r]));
    const computedFieldIds = Array.from(computedFieldsMap.keys()).sort();

    for (const afterRecord of [...afterTable.records].sort((a, b) => a.id.localeCompare(b.id))) {
      const beforeRecord = beforeRecords.get(afterRecord.id);
      if (!beforeRecord) {
        continue;
      }
      collectRecordComputedImpact(
        afterTable,
        beforeRecord,
        afterRecord,
        computedFieldIds,
        computedFieldsMap,
        changes
      );
    }
  }

  return {
    changes,
    totalAffectedCells: changes.length,
  };
}
