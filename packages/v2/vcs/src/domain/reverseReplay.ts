import { canonicalizeSnapshot, cloneVcsValue, isEmptyVcsCellValue } from './fieldClassification';
import type {
  IBaseVcsSnapshot,
  IFieldVcsSnapshot,
  IRecordVcsSnapshot,
  ITableVcsSnapshot,
  IVcsStoredChange,
  IViewVcsSnapshot,
} from './types';

function ensureTable(tableMap: Map<string, ITableVcsSnapshot>, tableId: string): ITableVcsSnapshot {
  const existing = tableMap.get(tableId);
  if (existing) {
    return existing;
  }
  const placeholder: ITableVcsSnapshot = {
    id: tableId,
    name: tableId,
    primaryFieldId: '',
    fields: [],
    views: [],
    records: [],
  };
  tableMap.set(tableId, placeholder);
  return placeholder;
}

function restoreDeletedTableSnapshot(
  prev: Partial<ITableVcsSnapshot>,
  tableId: string
): ITableVcsSnapshot {
  return {
    id: prev.id ?? tableId,
    name: prev.name ?? tableId,
    ...(prev.dbTableName !== undefined ? { dbTableName: prev.dbTableName } : {}),
    primaryFieldId: prev.primaryFieldId ?? '',
    fields: prev.fields ? cloneVcsValue([...prev.fields]) : [],
    views: prev.views ? cloneVcsValue([...prev.views]) : [],
    records: prev.records ? cloneVcsValue([...prev.records]) : [],
  };
}

function applyReverseTableChange(
  tableMap: Map<string, ITableVcsSnapshot>,
  change: IVcsStoredChange
): void {
  if (change.opKind === 'create' || (change.opKind === 'upsert' && change.beforeValue == null)) {
    tableMap.delete(change.tableId);
    return;
  }
  const prev = change.beforeValue as Partial<ITableVcsSnapshot> | null | undefined;
  if (!prev || typeof prev !== 'object') {
    return;
  }
  if (change.opKind === 'delete') {
    tableMap.set(change.tableId, restoreDeletedTableSnapshot(prev, change.tableId));
    return;
  }
  const current = ensureTable(tableMap, change.tableId);
  tableMap.set(change.tableId, {
    ...current,
    ...(prev.name !== undefined ? { name: prev.name } : {}),
    ...(prev.primaryFieldId !== undefined ? { primaryFieldId: prev.primaryFieldId } : {}),
    ...(prev.dbTableName !== undefined ? { dbTableName: prev.dbTableName } : {}),
  });
}

function applyReverseFieldChange(
  tableMap: Map<string, ITableVcsSnapshot>,
  change: IVcsStoredChange
): void {
  const isCreate =
    change.opKind === 'create' || (change.opKind === 'upsert' && change.beforeValue == null);
  const table = tableMap.get(change.tableId);
  if (isCreate) {
    if (!table) return;
    tableMap.set(change.tableId, {
      ...table,
      fields: table.fields.filter((f) => f.id !== change.entityId),
    });
    return;
  }

  const prevField = change.beforeValue as IFieldVcsSnapshot | null | undefined;
  if (!prevField) return;
  const target = ensureTable(tableMap, change.tableId);
  const nextFields = target.fields.filter((f) => f.id !== change.entityId);
  nextFields.push(cloneVcsValue(prevField));
  tableMap.set(change.tableId, {
    ...target,
    fields: nextFields,
  });
}

function applyReverseViewChange(
  tableMap: Map<string, ITableVcsSnapshot>,
  change: IVcsStoredChange
): void {
  const isCreate =
    change.opKind === 'create' || (change.opKind === 'upsert' && change.beforeValue == null);
  const table = tableMap.get(change.tableId);
  if (isCreate) {
    if (!table) return;
    tableMap.set(change.tableId, {
      ...table,
      views: table.views.filter((v) => v.id !== change.entityId),
    });
    return;
  }

  const prevView = change.beforeValue as IViewVcsSnapshot | null | undefined;
  if (!prevView) return;
  const target = ensureTable(tableMap, change.tableId);
  const nextViews = target.views.filter((v) => v.id !== change.entityId);
  nextViews.push(cloneVcsValue(prevView));
  tableMap.set(change.tableId, {
    ...target,
    views: nextViews,
  });
}

function mergeReverseRecordSnapshot(
  existing: IRecordVcsSnapshot,
  prevRecord: Partial<IRecordVcsSnapshot>
): IRecordVcsSnapshot {
  const nextFields: Record<string, unknown> = { ...existing.fields };
  if (prevRecord.fields) {
    for (const [fieldId, val] of Object.entries(prevRecord.fields)) {
      if (isEmptyVcsCellValue(val)) {
        delete nextFields[fieldId];
      } else {
        nextFields[fieldId] = cloneVcsValue(val);
      }
    }
  }
  const nextOrders = prevRecord.orders
    ? { ...(existing.orders ?? {}), ...cloneVcsValue(prevRecord.orders) }
    : existing.orders;
  return {
    id: existing.id,
    ...(existing.autoNumber !== undefined ? { autoNumber: existing.autoNumber } : {}),
    fields: nextFields,
    ...(nextOrders && Object.keys(nextOrders).length > 0 ? { orders: nextOrders } : {}),
  };
}

function restoreDeletedRecord(
  recordId: string,
  prevRecord: Partial<IRecordVcsSnapshot>
): IRecordVcsSnapshot {
  return {
    id: prevRecord.id ?? recordId,
    fields: prevRecord.fields ? cloneVcsValue(prevRecord.fields) : {},
    ...(prevRecord.version !== undefined ? { version: prevRecord.version } : {}),
    ...(prevRecord.autoNumber !== undefined ? { autoNumber: prevRecord.autoNumber } : {}),
    ...(prevRecord.orders ? { orders: cloneVcsValue(prevRecord.orders) } : {}),
  };
}

function applyReverseRecordChange(
  tableMap: Map<string, ITableVcsSnapshot>,
  change: IVcsStoredChange
): void {
  if (change.opKind === 'create' || (change.opKind === 'upsert' && change.beforeValue == null)) {
    const table = tableMap.get(change.tableId);
    if (!table) return;
    tableMap.set(change.tableId, {
      ...table,
      records: table.records.filter((r) => r.id !== change.entityId),
    });
    return;
  }

  const prevRecord = change.beforeValue as Partial<IRecordVcsSnapshot> | null | undefined;
  if (!prevRecord || typeof prevRecord !== 'object') {
    return;
  }

  const target = ensureTable(tableMap, change.tableId);
  const recordMap = new Map(target.records.map((r) => [r.id, cloneVcsValue(r)]));
  if (change.opKind === 'delete') {
    recordMap.set(change.entityId, restoreDeletedRecord(change.entityId, prevRecord));
  } else {
    const existing = recordMap.get(change.entityId) ?? { id: change.entityId, fields: {} };
    recordMap.set(change.entityId, mergeReverseRecordSnapshot(existing, prevRecord));
  }
  tableMap.set(change.tableId, { ...target, records: Array.from(recordMap.values()) });
}

export function applyReverseChangesOneStep(
  snapshot: IBaseVcsSnapshot,
  changes: readonly IVcsStoredChange[],
  options?: { readonly targetRevision?: number }
): IBaseVcsSnapshot {
  const tableMap = new Map<string, ITableVcsSnapshot>(
    snapshot.tables.map((t) => [t.id, cloneVcsValue(t)])
  );

  // Reverse seq order undoes intra-transaction order cleanly.
  const ordered = [...changes].sort((a, b) => b.seq - a.seq);
  for (const change of ordered) {
    if (change.entityType === 'table') {
      applyReverseTableChange(tableMap, change);
    } else if (change.entityType === 'field') {
      applyReverseFieldChange(tableMap, change);
    } else if (change.entityType === 'view') {
      applyReverseViewChange(tableMap, change);
    } else if (change.entityType === 'record') {
      applyReverseRecordChange(tableMap, change);
    }
  }

  const targetRevision = options?.targetRevision ?? Math.max(0, snapshot.revision - 1);
  return canonicalizeSnapshot(
    {
      ...snapshot,
      revision: targetRevision,
      tables: Array.from(tableMap.values()),
    },
    { preserveComputed: true }
  );
}
