import type { IBaseVcsPatch, ITableVcsPatch, IVcsDirtyKey } from './types';

function formatDirtyKey(tableId: string, entityType: string, entityId: string): string {
  return `${tableId}:${entityType}:${entityId}`;
}

interface IncomingTableTouchSummary {
  tableTouched: boolean;
  fieldIds: Set<string>;
  viewIds: Set<string>;
  recordIds: Set<string>;
  recordTouchedFieldIds: Set<string>;
  hasRecordAdds: boolean;
  hasAnyChange: boolean;
}

function collectRecordTouchedIds(
  tablePatch: ITableVcsPatch,
  recordIds: Set<string>,
  recordTouchedFieldIds: Set<string>
): void {
  for (const r of tablePatch.recordsAdded) {
    recordIds.add(r.id);
    for (const fid of Object.keys(r.fields)) {
      recordTouchedFieldIds.add(fid);
    }
  }
  for (const r of tablePatch.recordsUpdated) {
    recordIds.add(r.recordId);
    for (const c of r.cellChanges) {
      recordTouchedFieldIds.add(c.fieldId);
    }
  }
  for (const r of tablePatch.recordsDeleted) {
    recordIds.add(r.recordId);
    if (r.before?.fields) {
      for (const fid of Object.keys(r.before.fields)) {
        recordTouchedFieldIds.add(fid);
      }
    }
  }
}

function summarizeIncomingTablePatch(tablePatch: ITableVcsPatch): IncomingTableTouchSummary {
  const fieldIds = new Set<string>([
    ...tablePatch.fieldsAdded.map((f) => f.id),
    ...tablePatch.fieldsUpdated.map((f) => f.fieldId),
    ...tablePatch.fieldsDeleted.map((f) => f.fieldId),
  ]);
  const viewIds = new Set<string>([
    ...tablePatch.viewsAdded.map((v) => v.id),
    ...tablePatch.viewsUpdated.map((v) => v.viewId),
    ...tablePatch.viewsDeleted.map((v) => v.viewId),
  ]);

  const recordIds = new Set<string>();
  const recordTouchedFieldIds = new Set<string>();
  collectRecordTouchedIds(tablePatch, recordIds, recordTouchedFieldIds);

  const hasRecordAdds = tablePatch.recordsAdded.length > 0;
  const tableTouched = tablePatch.nameChange !== undefined;
  const hasAnyChange = tableTouched || fieldIds.size > 0 || viewIds.size > 0 || recordIds.size > 0;

  return {
    tableTouched,
    fieldIds,
    viewIds,
    recordIds,
    recordTouchedFieldIds,
    hasRecordAdds,
    hasAnyChange,
  };
}

function doesDirtyKeyOverlapIncoming(
  key: IVcsDirtyKey,
  summary: IncomingTableTouchSummary
): boolean {
  if (!summary.hasAnyChange) {
    return false;
  }

  if (summary.tableTouched || key.entityType === 'table') {
    return true;
  }

  if (key.entityType === 'field') {
    return summary.fieldIds.has(key.entityId) || summary.recordTouchedFieldIds.has(key.entityId);
  }

  if (key.entityType === 'view') {
    return summary.viewIds.has(key.entityId);
  }

  if (key.entityType === 'record') {
    return summary.recordIds.has(key.entityId);
  }

  return false;
}

export function canRebasePatchCleanly(
  concurrentDirtyKeys: readonly IVcsDirtyKey[],
  incomingPatch: IBaseVcsPatch
): { ok: true } | { ok: false; overlappingKeys: readonly string[] } {
  const overlaps = new Set<string>();

  const wholeTablesTouchedByIncoming = new Set<string>([
    ...incomingPatch.tablesAdded.map((t) => t.id),
    ...incomingPatch.tablesDeleted.map((t) => t.tableId),
  ]);

  const updatedByTableId = new Map<string, IncomingTableTouchSummary>(
    incomingPatch.tablesUpdated.map((patch) => [patch.tableId, summarizeIncomingTablePatch(patch)])
  );

  for (const key of concurrentDirtyKeys) {
    if (wholeTablesTouchedByIncoming.has(key.tableId)) {
      overlaps.add(formatDirtyKey(key.tableId, key.entityType, key.entityId));
      continue;
    }

    const summary = updatedByTableId.get(key.tableId);
    if (summary && doesDirtyKeyOverlapIncoming(key, summary)) {
      overlaps.add(formatDirtyKey(key.tableId, key.entityType, key.entityId));
    }
  }

  if (overlaps.size === 0) {
    return { ok: true };
  }

  return {
    ok: false,
    overlappingKeys: Array.from(overlaps).sort(),
  };
}
