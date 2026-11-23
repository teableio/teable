import {
  canonicalizeSnapshot,
  canonicalizeTable,
  sortRecordsCanonically,
} from './fieldClassification';
import type { IBaseVcsSnapshot, ITableVcsSnapshot, IVcsIncrementalChanges } from './types';

function applyRecordDelta(
  table: ITableVcsSnapshot,
  upserts: readonly ITableVcsSnapshot['records'][number][],
  deletes: readonly string[]
): ITableVcsSnapshot {
  const recordMap = new Map(table.records.map((record) => [record.id, record]));
  for (const deleteId of deletes) {
    recordMap.delete(deleteId);
  }
  for (const upsertRecord of upserts) {
    recordMap.set(upsertRecord.id, upsertRecord);
  }

  return {
    ...table,
    records: sortRecordsCanonically(Array.from(recordMap.values()), table.fields),
  };
}

function applyUpsertedAndDeletedTables(
  tableMap: Map<string, ITableVcsSnapshot>,
  changes: IVcsIncrementalChanges
): void {
  for (const deletedTableId of changes.deletedTableIds) {
    tableMap.delete(deletedTableId);
  }
  for (const upsertedTable of changes.upsertedTables) {
    const existing = tableMap.get(upsertedTable.id);
    const mergedRecords =
      upsertedTable.records.length > 0 ? upsertedTable.records : (existing?.records ?? []);
    tableMap.set(upsertedTable.id, canonicalizeTable({ ...upsertedTable, records: mergedRecords }));
  }
}

export function applyIncrementalChanges(
  baseSnapshot: IBaseVcsSnapshot,
  changes: IVcsIncrementalChanges
): IBaseVcsSnapshot {
  const nextCursor = changes.nextCursor ?? baseSnapshot.cursor;
  if (changes.requiresFullSync && changes.fullSnapshot) {
    return canonicalizeSnapshot({
      ...changes.fullSnapshot,
      revision: changes.toRevision,
      ...(nextCursor !== undefined ? { cursor: nextCursor } : {}),
      ...(changes.accessScope ? { accessScope: changes.accessScope } : {}),
    });
  }

  const tableMap = new Map<string, ITableVcsSnapshot>(
    baseSnapshot.tables.map((table) => [table.id, table])
  );
  applyUpsertedAndDeletedTables(tableMap, changes);

  for (const delta of changes.recordDeltas) {
    const existing = tableMap.get(delta.tableId);
    if (existing) {
      tableMap.set(delta.tableId, applyRecordDelta(existing, delta.upserts, delta.deletes));
    }
  }

  const resolvedScope = changes.accessScope ?? baseSnapshot.accessScope;
  return canonicalizeSnapshot({
    formatVersion: baseSnapshot.formatVersion,
    baseId: changes.baseId,
    baseName: changes.baseName,
    revision: changes.toRevision,
    ...(nextCursor !== undefined ? { cursor: nextCursor } : {}),
    capturedAt: baseSnapshot.capturedAt,
    tables: Array.from(tableMap.values()),
    ...(resolvedScope ? { accessScope: resolvedScope } : {}),
  });
}
