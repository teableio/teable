/**
 * Grid cell loading splits two field sets:
 * - subscribe projection (ShareDB query identity): stable prefix of view-visible fields
 * - cell projection (HTTP fill): freeze ∪ real viewport ∪ overscan
 *
 * Viewport field ids must never enter the ShareDB query. Changing
 * query.projection recreates the subscription and drops live ops.
 * Shared grids keep the same lazy-loading contract. HTTP fills and schema
 * refreshes use the share records endpoint without viewId/ignoreViewQuery;
 * the server owns the shared view's row and field visibility boundaries.
 */

export const CELL_PROJECTION_THRESHOLD = 24;
export const COLUMN_FILL_OVERSCAN = 2;

export const frozenFieldIdsFromView = ({
  orderedVisibleFieldIds,
  frozenFieldId,
  frozenColumnCount,
}: {
  orderedVisibleFieldIds: readonly string[];
  frozenFieldId?: string;
  frozenColumnCount?: number;
}): string[] => {
  if (frozenFieldId) {
    const idx = orderedVisibleFieldIds.indexOf(frozenFieldId);
    if (idx >= 0) {
      return orderedVisibleFieldIds.slice(0, idx + 1);
    }
  }
  const count = frozenColumnCount ?? 1;
  if (count <= 0) {
    return [];
  }
  return orderedVisibleFieldIds.slice(0, Math.min(count, orderedVisibleFieldIds.length));
};

export const buildSubscribeProjection = ({
  orderedVisibleFieldIds,
  frozenFieldIds = [],
  primaryFieldId,
  threshold = CELL_PROJECTION_THRESHOLD,
}: {
  orderedVisibleFieldIds: readonly string[];
  frozenFieldIds?: readonly string[];
  primaryFieldId?: string;
  threshold?: number;
}): string[] => {
  if (orderedVisibleFieldIds.length === 0) {
    return [];
  }
  if (orderedVisibleFieldIds.length <= threshold) {
    return [...orderedVisibleFieldIds].sort((a, b) => Number(a > b) - Number(a < b));
  }

  const visible = new Set(orderedVisibleFieldIds);
  const selected = new Set<string>();
  if (primaryFieldId && visible.has(primaryFieldId)) {
    selected.add(primaryFieldId);
  }
  for (const fieldId of frozenFieldIds) {
    if (visible.has(fieldId)) {
      selected.add(fieldId);
    }
  }
  for (const fieldId of orderedVisibleFieldIds) {
    if (selected.size >= threshold) {
      break;
    }
    selected.add(fieldId);
  }
  return [...selected].sort((a, b) => Number(a > b) - Number(a < b));
};

export const viewportFieldIds = ({
  orderedVisibleFieldIds,
  startColumnIndex,
  columnSpan,
  freezeCount,
  overscan = COLUMN_FILL_OVERSCAN,
}: {
  orderedVisibleFieldIds: readonly string[];
  startColumnIndex: number;
  columnSpan: number;
  freezeCount: number;
  overscan?: number;
}): string[] => {
  const n = orderedVisibleFieldIds.length;
  if (n === 0) {
    return [];
  }
  const freezeIds = orderedVisibleFieldIds.slice(0, Math.max(0, Math.min(freezeCount, n)));
  const start = Math.max(0, startColumnIndex - overscan);
  const endInclusive = Math.min(n - 1, startColumnIndex + Math.max(0, columnSpan) + overscan);
  const viewIds = orderedVisibleFieldIds.slice(start, endInclusive + 1);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const fieldId of [...freezeIds, ...viewIds]) {
    if (seen.has(fieldId)) {
      continue;
    }
    seen.add(fieldId);
    out.push(fieldId);
  }
  return out;
};

export const missingFieldIds = (needed: readonly string[], loaded: ReadonlySet<string>): string[] =>
  needed.filter((fieldId) => !loaded.has(fieldId));

export const resolveRecordSubscribeProjection = ({
  sparseColumnFill,
  requestedProjection,
  orderedVisibleFieldIds,
  frozenFieldIds,
  primaryFieldId,
  readableFieldIds,
}: {
  sparseColumnFill: boolean;
  requestedProjection?: readonly string[];
  orderedVisibleFieldIds: readonly string[];
  frozenFieldIds?: readonly string[];
  primaryFieldId?: string;
  readableFieldIds?: ReadonlySet<string>;
}): string[] => {
  if (requestedProjection && requestedProjection.length === 0) {
    return [];
  }

  const keepRequested = (fieldId: string) =>
    readableFieldIds == null || readableFieldIds.has(fieldId);

  if (!sparseColumnFill) {
    const ids = requestedProjection?.length
      ? requestedProjection.filter(keepRequested)
      : orderedVisibleFieldIds;
    return [...new Set(ids)].sort((a, b) => Number(a > b) - Number(a < b));
  }

  return buildSubscribeProjection({
    orderedVisibleFieldIds,
    frozenFieldIds,
    primaryFieldId,
  });
};

export type ILoadedRecordFields = {
  source: object | undefined;
  fields: ReadonlySet<string>;
};

export type IFillRecord = {
  id: string;
  docSource?: object;
};

export const loadedFieldsForRecord = (
  record: IFillRecord,
  loadedByRecord: ReadonlyMap<string, ILoadedRecordFields>,
  snapshotFieldIds: ReadonlySet<string>
): ReadonlySet<string> => {
  const entry = loadedByRecord.get(record.id);
  if (entry && entry.source === record.docSource) {
    return entry.fields;
  }
  return snapshotFieldIds;
};

export const missingFieldsAcrossRecords = (
  records: readonly IFillRecord[],
  neededFieldIds: readonly string[],
  loadedByRecord: ReadonlyMap<string, ILoadedRecordFields>,
  snapshotFieldIds: ReadonlySet<string>
): string[] => {
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    const have = loadedFieldsForRecord(record, loadedByRecord, snapshotFieldIds);
    for (const fieldId of neededFieldIds) {
      if (!have.has(fieldId) && !seen.has(fieldId)) {
        seen.add(fieldId);
        missing.push(fieldId);
      }
    }
  }
  return missing;
};

export const markRecordsFieldsLoaded = (
  loadedByRecord: ReadonlyMap<string, ILoadedRecordFields>,
  records: readonly IFillRecord[],
  fieldIds: readonly string[],
  snapshotFieldIds: ReadonlySet<string>
): Map<string, ILoadedRecordFields> => {
  const next = new Map<string, ILoadedRecordFields>();
  for (const [recordId, entry] of loadedByRecord) {
    next.set(recordId, { source: entry.source, fields: new Set(entry.fields) });
  }
  for (const record of records) {
    const have = new Set(loadedFieldsForRecord(record, next, snapshotFieldIds));
    for (const fieldId of fieldIds) {
      have.add(fieldId);
    }
    next.set(record.id, { source: record.docSource, fields: have });
  }
  return next;
};

export const pruneLoadedFieldsToRecordIds = (
  loadedByRecord: ReadonlyMap<string, ILoadedRecordFields>,
  recordIds: readonly string[]
): Map<string, ILoadedRecordFields> | undefined => {
  if (loadedByRecord.size === 0) {
    return undefined;
  }
  const keep = new Set(recordIds);
  const next = new Map<string, ILoadedRecordFields>();
  for (const [recordId, entry] of loadedByRecord) {
    if (keep.has(recordId)) {
      next.set(recordId, entry);
    }
  }
  return next.size === loadedByRecord.size ? undefined : next;
};
