import {
  FieldCreated,
  FieldDeleted,
  FieldDuplicated,
  FieldOptionsAdded,
  FieldUpdated,
  RecordCreated,
  RecordReordered,
  RecordUpdated,
  RecordsBatchCreated,
  RecordsBatchUpdated,
  RecordsDeleted,
  TableCreated,
  TableDeleted,
  TablePropertiesUpdated,
  TableRenamed,
  TableRestored,
  TableTrashed,
  ViewColumnMetaUpdated,
  ViewCreated,
  ViewDeleted,
  ViewDescriptionUpdated,
  ViewFilterUpdated,
  ViewGroupUpdated,
  ViewManualSortApplied,
  ViewOptionsUpdated,
  ViewOrderUpdated,
  ViewRenamed,
  ViewSortUpdated,
  type DomainError,
  type LinkField,
  type Result,
  type Table,
} from '@teable/v2-core';
import { err, ok } from 'neverthrow';

import type { IVcsChangeRowInput } from '../ports/server';
import {
  mapSingleFieldToVcsSnapshot,
  mapSingleViewFromDomain,
  mapTableFieldsToVcsSnapshots,
  mapTableViewsFromDomain,
} from '../snapshot/tableToVcsSnapshot';

export type BaseVcsTrackedEvent =
  | TableCreated
  | TableDeleted
  | TableRestored
  | TableTrashed
  | TableRenamed
  | TablePropertiesUpdated
  | FieldCreated
  | FieldUpdated
  | FieldDeleted
  | FieldOptionsAdded
  | FieldDuplicated
  | ViewCreated
  | ViewDeleted
  | ViewRenamed
  | ViewDescriptionUpdated
  | ViewFilterUpdated
  | ViewGroupUpdated
  | ViewSortUpdated
  | ViewOrderUpdated
  | ViewColumnMetaUpdated
  | ViewOptionsUpdated
  | ViewManualSortApplied
  | RecordCreated
  | RecordsBatchCreated
  | RecordUpdated
  | RecordsBatchUpdated
  | RecordsDeleted
  | RecordReordered;

export type IVcsDirtyKeyInput = IVcsChangeRowInput;

interface ITwoWayLinkColumn {
  readonly fieldId: string;
  readonly foreignTableId: string;
  readonly symmetricFieldId: string;
}

const safeFieldSnapshot = (
  table: Table | undefined,
  fieldId: string
): Result<unknown | null, DomainError> => {
  if (!table) return ok(null);
  const field = table.getFields().find((f) => f.id().toString() === fieldId);
  if (!field) return ok(null);
  return mapSingleFieldToVcsSnapshot(table, field);
};

const safeViewSnapshot = (
  table: Table | undefined,
  viewId: string
): Result<unknown | null, DomainError> => {
  if (!table) return ok(null);
  const view = table.views().find((v) => v.id().toString() === viewId);
  if (!view) return ok(null);
  return mapSingleViewFromDomain(table, view);
};

const safeTableMetaSnapshot = (table: Table | undefined): unknown | null => {
  if (!table) return null;
  const dbTableNameRes = table.dbTableName().andThen((n) => n.value());
  return {
    id: table.id().toString(),
    name: table.name().toString(),
    ...(dbTableNameRes.isOk() ? { dbTableName: dbTableNameRes.value } : {}),
    primaryFieldId: table.primaryFieldId().toString(),
  };
};

const safeFullTableSnapshot = (table: Table | undefined): Result<unknown | null, DomainError> => {
  if (!table) return ok(null);
  const fieldsRes = mapTableFieldsToVcsSnapshots(table);
  if (fieldsRes.isErr()) return err(fieldsRes.error);
  const viewsRes = mapTableViewsFromDomain(table);
  if (viewsRes.isErr()) return err(viewsRes.error);
  const dbTableNameRes = table.dbTableName().andThen((n) => n.value());
  return ok({
    id: table.id().toString(),
    name: table.name().toString(),
    ...(dbTableNameRes.isOk() ? { dbTableName: dbTableNameRes.value } : {}),
    primaryFieldId: table.primaryFieldId().toString(),
    fields: fieldsRes.value,
    views: viewsRes.value,
    records: [],
  });
};

const extractLinkedRecordIdsFromCell = (raw: unknown): string[] => {
  if (raw == null) return [];
  if (typeof raw === 'string') {
    return raw.length > 0 ? [raw] : [];
  }
  if (Array.isArray(raw)) {
    const out: string[] = [];
    for (const item of raw) {
      if (typeof item === 'string' && item.length > 0) {
        out.push(item);
      } else if (
        item !== null &&
        typeof item === 'object' &&
        typeof (item as { id?: unknown }).id === 'string'
      ) {
        out.push((item as { id: string }).id);
      }
    }
    return out;
  }
  if (typeof raw === 'object' && typeof (raw as { id?: unknown }).id === 'string') {
    return [(raw as { id: string }).id];
  }
  return [];
};

const collectTwoWayLinkFields = (table: Table): ITwoWayLinkColumn[] => {
  const twoWayLinks: ITwoWayLinkColumn[] = [];
  for (const field of table.getFields()) {
    if (field.type().toString() !== 'link') continue;
    const cfgRes = (field as unknown as LinkField).configDto();
    if (
      cfgRes.isOk() &&
      !cfgRes.value.isOneWay &&
      cfgRes.value.foreignTableId &&
      cfgRes.value.symmetricFieldId
    ) {
      twoWayLinks.push({
        fieldId: field.id().toString(),
        foreignTableId: cfgRes.value.foreignTableId,
        symmetricFieldId: cfgRes.value.symmetricFieldId,
      });
    }
  }
  return twoWayLinks;
};

const appendForeignTargetsForField = (params: {
  readonly link: ITwoWayLinkColumn;
  readonly rawValues: readonly unknown[];
  readonly sourceTableId: string;
  readonly skipSourceRecordIds: ReadonlySet<string>;
  readonly seenForeign: Set<string>;
  readonly cascades: IVcsChangeRowInput[];
}): void => {
  const { link, rawValues, sourceTableId, skipSourceRecordIds, seenForeign, cascades } = params;
  for (const rawValue of rawValues) {
    for (const foreignRecordId of extractLinkedRecordIdsFromCell(rawValue)) {
      if (link.foreignTableId === sourceTableId && skipSourceRecordIds.has(foreignRecordId)) {
        continue;
      }
      const key = `${link.foreignTableId}\0${foreignRecordId}\0${link.symmetricFieldId}`;
      if (seenForeign.has(key)) continue;
      seenForeign.add(key);
      cascades.push({
        tableId: link.foreignTableId,
        entityType: 'record',
        entityId: foreignRecordId,
        fieldId: link.symmetricFieldId,
        opKind: 'update',
        beforeValue: null,
        afterValue: null,
      });
    }
  }
};

const collectSymmetricLinkEntries = (
  table: Table,
  sourceTableId: string,
  entries: ReadonlyArray<{
    readonly valuesByFieldId: ReadonlyMap<string, readonly unknown[]>;
  }>,
  skipSourceRecordIds: ReadonlySet<string>
): IVcsChangeRowInput[] => {
  const twoWayLinks = collectTwoWayLinkFields(table);
  if (twoWayLinks.length === 0) {
    return [];
  }
  const linksByFieldId = new Map(twoWayLinks.map((link) => [link.fieldId, link]));
  const seenForeign = new Set<string>();
  const cascades: IVcsChangeRowInput[] = [];

  for (const entry of entries) {
    for (const [fieldId, rawValues] of entry.valuesByFieldId.entries()) {
      const link = linksByFieldId.get(fieldId);
      if (!link) continue;
      appendForeignTargetsForField({
        link,
        rawValues,
        sourceTableId,
        skipSourceRecordIds,
        seenForeign,
        cascades,
      });
    }
  }

  return cascades;
};

const addFieldValue = (map: Map<string, unknown[]>, fieldId: string, value: unknown): void => {
  const existing = map.get(fieldId);
  if (existing) {
    existing.push(value);
  } else {
    map.set(fieldId, [value]);
  }
};

export const collectSymmetricDeleteCascadeChanges = (
  table: Table,
  sourceTableId: string,
  event: RecordsDeleted
): IVcsChangeRowInput[] => {
  if (event.recordSnapshots.length === 0) {
    return [];
  }
  const entries = event.recordSnapshots.map((snap) => {
    const valuesByFieldId = new Map<string, unknown[]>();
    for (const [fieldId, rawValue] of Object.entries(snap.fields)) {
      addFieldValue(valuesByFieldId, fieldId, rawValue);
    }
    return { valuesByFieldId };
  });
  return collectSymmetricLinkEntries(
    table,
    sourceTableId,
    entries,
    new Set(event.recordIds.map((id) => id.toString()))
  );
};

export const collectSymmetricRecordWriteCascadeChanges = (
  table: Table,
  sourceTableId: string,
  event: BaseVcsTrackedEvent
): IVcsChangeRowInput[] => {
  if (event instanceof RecordCreated) {
    const valuesByFieldId = new Map<string, unknown[]>();
    for (const fv of event.fieldValues) {
      addFieldValue(valuesByFieldId, fv.fieldId, fv.value);
    }
    return collectSymmetricLinkEntries(
      table,
      sourceTableId,
      [{ valuesByFieldId }],
      new Set([event.recordId.toString()])
    );
  }
  if (event instanceof RecordsBatchCreated) {
    const skipIds = new Set(event.records.map((r) => r.recordId));
    const entries = event.records.map((rec) => {
      const valuesByFieldId = new Map<string, unknown[]>();
      for (const fv of rec.fields) {
        addFieldValue(valuesByFieldId, fv.fieldId, fv.value);
      }
      return { valuesByFieldId };
    });
    return collectSymmetricLinkEntries(table, sourceTableId, entries, skipIds);
  }
  if (event instanceof RecordUpdated && event.source !== 'computed') {
    const valuesByFieldId = new Map<string, unknown[]>();
    for (const ch of event.changes) {
      addFieldValue(valuesByFieldId, ch.fieldId, ch.oldValue);
      addFieldValue(valuesByFieldId, ch.fieldId, ch.newValue);
    }
    return collectSymmetricLinkEntries(
      table,
      sourceTableId,
      [{ valuesByFieldId }],
      new Set([event.recordId.toString()])
    );
  }
  if (event instanceof RecordsBatchUpdated && event.source !== 'computed') {
    const skipIds = new Set(event.updates.map((u) => u.recordId));
    const entries = event.updates.map((upd) => {
      const valuesByFieldId = new Map<string, unknown[]>();
      for (const ch of upd.changes) {
        addFieldValue(valuesByFieldId, ch.fieldId, ch.oldValue);
        addFieldValue(valuesByFieldId, ch.fieldId, ch.newValue);
      }
      return { valuesByFieldId };
    });
    return collectSymmetricLinkEntries(table, sourceTableId, entries, skipIds);
  }
  if (event instanceof RecordsDeleted) {
    return collectSymmetricDeleteCascadeChanges(table, sourceTableId, event);
  }
  return [];
};

const extractTableDirtyKeys = (
  event: BaseVcsTrackedEvent,
  tableId: string
): IVcsDirtyKeyInput[] | null => {
  if (event instanceof TableCreated || event instanceof TableRestored) {
    return [{ tableId, entityType: 'table', entityId: tableId, opKind: 'create' }];
  }
  if (event instanceof TableRenamed || event instanceof TablePropertiesUpdated) {
    return [{ tableId, entityType: 'table', entityId: tableId, opKind: 'update' }];
  }
  if (event instanceof TableDeleted || event instanceof TableTrashed) {
    return [{ tableId, entityType: 'table', entityId: tableId, opKind: 'delete' }];
  }
  return null;
};

const extractFieldDirtyKeys = (
  event: BaseVcsTrackedEvent,
  tableId: string
): IVcsDirtyKeyInput[] | null => {
  if (event instanceof FieldCreated) {
    return [{ tableId, entityType: 'field', entityId: event.fieldId.toString(), opKind: 'create' }];
  }
  if (event instanceof FieldUpdated || event instanceof FieldOptionsAdded) {
    return [{ tableId, entityType: 'field', entityId: event.fieldId.toString(), opKind: 'update' }];
  }
  if (event instanceof FieldDuplicated) {
    return [
      { tableId, entityType: 'field', entityId: event.newFieldId.toString(), opKind: 'create' },
    ];
  }
  if (event instanceof FieldDeleted) {
    return [{ tableId, entityType: 'field', entityId: event.fieldId.toString(), opKind: 'delete' }];
  }
  return null;
};

const extractViewDirtyKeys = (
  event: BaseVcsTrackedEvent,
  tableId: string
): IVcsDirtyKeyInput[] | null => {
  if (event instanceof ViewCreated) {
    return [{ tableId, entityType: 'view', entityId: event.viewId.toString(), opKind: 'create' }];
  }
  if (
    event instanceof ViewRenamed ||
    event instanceof ViewDescriptionUpdated ||
    event instanceof ViewFilterUpdated ||
    event instanceof ViewGroupUpdated ||
    event instanceof ViewSortUpdated ||
    event instanceof ViewOrderUpdated ||
    event instanceof ViewColumnMetaUpdated ||
    event instanceof ViewOptionsUpdated ||
    event instanceof ViewManualSortApplied
  ) {
    return [{ tableId, entityType: 'view', entityId: event.viewId.toString(), opKind: 'update' }];
  }
  if (event instanceof ViewDeleted) {
    return [{ tableId, entityType: 'view', entityId: event.viewId.toString(), opKind: 'delete' }];
  }
  return null;
};

const mapRecordUpdateChange = (
  tableId: string,
  recordId: string,
  changes: ReadonlyArray<{ fieldId: string; oldValue: unknown; newValue: unknown }>
): IVcsDirtyKeyInput => {
  const beforeFields: Record<string, unknown> = {};
  const afterFields: Record<string, unknown> = {};
  for (const ch of changes) {
    beforeFields[ch.fieldId] = ch.oldValue ?? null;
    afterFields[ch.fieldId] = ch.newValue ?? null;
  }
  return {
    tableId,
    entityType: 'record',
    entityId: recordId,
    opKind: 'update',
    beforeValue: { id: recordId, fields: beforeFields },
    afterValue: { id: recordId, fields: afterFields },
  };
};

const extractRecordCreateDirtyKeys = (
  event: BaseVcsTrackedEvent,
  tableId: string
): IVcsDirtyKeyInput[] | null => {
  if (event instanceof RecordCreated) {
    const afterFields: Record<string, unknown> = {};
    for (const fv of event.fieldValues) {
      afterFields[fv.fieldId] = fv.value;
    }
    const recId = event.recordId.toString();
    return [
      {
        tableId,
        entityType: 'record',
        entityId: recId,
        opKind: 'create',
        beforeValue: null,
        afterValue: { id: recId, fields: afterFields },
      },
    ];
  }
  if (event instanceof RecordsBatchCreated) {
    return event.records.map((record) => {
      const afterFields: Record<string, unknown> = {};
      for (const fv of record.fields) {
        afterFields[fv.fieldId] = fv.value;
      }
      return {
        tableId,
        entityType: 'record',
        entityId: record.recordId,
        opKind: 'create',
        beforeValue: null,
        afterValue: { id: record.recordId, fields: afterFields },
      };
    });
  }
  return null;
};

export const extractRecordDirtyKeys = (
  event: BaseVcsTrackedEvent,
  tableId: string
): IVcsDirtyKeyInput[] => {
  const created = extractRecordCreateDirtyKeys(event, tableId);
  if (created) {
    return created;
  }
  if (event instanceof RecordUpdated) {
    return [mapRecordUpdateChange(tableId, event.recordId.toString(), event.changes)];
  }
  if (event instanceof RecordsBatchUpdated) {
    return event.updates.map((u) => mapRecordUpdateChange(tableId, u.recordId, u.changes));
  }
  if (event instanceof RecordsDeleted) {
    const snapMap = new Map(event.recordSnapshots.map((s) => [s.id, s]));
    return event.recordIds.map((recordId) => {
      const recId = recordId.toString();
      const snap = snapMap.get(recId);
      return {
        tableId,
        entityType: 'record',
        entityId: recId,
        opKind: 'delete',
        beforeValue: snap
          ? { id: snap.id, fields: snap.fields, ...(snap.orders ? { orders: snap.orders } : {}) }
          : null,
        afterValue: null,
      };
    });
  }
  if (event instanceof RecordReordered) {
    const viewId = event.viewId.toString();
    return event.recordIds.map((recordId) => {
      const recId = recordId.toString();
      return {
        tableId,
        entityType: 'record',
        entityId: recId,
        opKind: 'update',
        beforeValue: { id: recId, orders: { [viewId]: event.previousOrdersByRecordId[recId] } },
        afterValue: { id: recId, orders: { [viewId]: event.ordersByRecordId[recId] } },
      };
    });
  }
  return [];
};

export const isComputedRecordUpdateEvent = (event: BaseVcsTrackedEvent): boolean =>
  (event instanceof RecordUpdated || event instanceof RecordsBatchUpdated) &&
  event.source === 'computed';

export const extractVcsDirtyKeysFromEvent = (event: BaseVcsTrackedEvent): IVcsDirtyKeyInput[] => {
  const tableId = event.tableId.toString();
  return (
    extractTableDirtyKeys(event, tableId) ??
    extractFieldDirtyKeys(event, tableId) ??
    extractViewDirtyKeys(event, tableId) ??
    extractRecordDirtyKeys(event, tableId)
  );
};

const buildTableRenameChange = (
  tableId: string,
  event: TableRenamed,
  prevTable: Table | undefined,
  nextTable: Table | undefined
): IVcsChangeRowInput[] => [
  {
    tableId,
    entityType: 'table',
    entityId: tableId,
    opKind: 'update',
    beforeValue: safeTableMetaSnapshot(prevTable) ?? {
      id: tableId,
      name: event.previousName.toString(),
    },
    afterValue: safeTableMetaSnapshot(nextTable) ?? {
      id: tableId,
      name: event.nextName.toString(),
    },
  },
];

const enrichTableEventChanges = (
  event: BaseVcsTrackedEvent,
  prevTable: Table | undefined,
  nextTable: Table | undefined
): Result<IVcsChangeRowInput[] | null, DomainError> => {
  const tableId = event.tableId.toString();
  if (event instanceof TableCreated || event instanceof TableRestored) {
    const snapRes = safeFullTableSnapshot(nextTable);
    if (snapRes.isErr()) return err(snapRes.error);
    return ok([
      {
        tableId,
        entityType: 'table',
        entityId: tableId,
        opKind: 'create',
        beforeValue: null,
        afterValue: snapRes.value ?? {
          id: tableId,
          name: event.tableName.toString(),
        },
      },
    ]);
  }
  if (event instanceof TableRenamed) {
    return ok(buildTableRenameChange(tableId, event, prevTable, nextTable));
  }
  if (event instanceof TablePropertiesUpdated) {
    return ok([
      {
        tableId,
        entityType: 'table',
        entityId: tableId,
        opKind: 'update',
        beforeValue: safeTableMetaSnapshot(prevTable) ?? { id: tableId },
        afterValue: safeTableMetaSnapshot(nextTable) ?? { id: tableId },
      },
    ]);
  }
  if (event instanceof TableDeleted || event instanceof TableTrashed) {
    const snapRes = safeFullTableSnapshot(prevTable);
    if (snapRes.isErr()) return err(snapRes.error);
    return ok([
      {
        tableId,
        entityType: 'table',
        entityId: tableId,
        opKind: 'delete',
        beforeValue: snapRes.value ?? {
          id: tableId,
          name: event.tableName.toString(),
        },
        afterValue: null,
      },
    ]);
  }
  return ok(null);
};

const enrichFieldEventChanges = (
  event: BaseVcsTrackedEvent,
  prevTable: Table | undefined,
  nextTable: Table | undefined
): Result<IVcsChangeRowInput[] | null, DomainError> => {
  const tableId = event.tableId.toString();
  if (event instanceof FieldCreated) {
    const fieldId = event.fieldId.toString();
    const afterRes = safeFieldSnapshot(nextTable, fieldId);
    if (afterRes.isErr()) return err(afterRes.error);
    return ok([
      {
        tableId,
        entityType: 'field',
        entityId: fieldId,
        opKind: 'create',
        beforeValue: null,
        afterValue: afterRes.value,
      },
    ]);
  }
  if (event instanceof FieldDuplicated) {
    const fieldId = event.newFieldId.toString();
    const afterRes = safeFieldSnapshot(nextTable, fieldId);
    if (afterRes.isErr()) return err(afterRes.error);
    return ok([
      {
        tableId,
        entityType: 'field',
        entityId: fieldId,
        opKind: 'create',
        beforeValue: null,
        afterValue: afterRes.value,
      },
    ]);
  }
  if (event instanceof FieldUpdated || event instanceof FieldOptionsAdded) {
    const fieldId = event.fieldId.toString();
    const beforeRes = safeFieldSnapshot(prevTable, fieldId);
    if (beforeRes.isErr()) return err(beforeRes.error);
    const afterRes = safeFieldSnapshot(nextTable, fieldId);
    if (afterRes.isErr()) return err(afterRes.error);
    return ok([
      {
        tableId,
        entityType: 'field',
        entityId: fieldId,
        opKind: 'update',
        beforeValue: beforeRes.value,
        afterValue: afterRes.value,
      },
    ]);
  }
  if (event instanceof FieldDeleted) {
    const fieldId = event.fieldId.toString();
    const beforeRes = safeFieldSnapshot(prevTable, fieldId);
    if (beforeRes.isErr()) return err(beforeRes.error);
    return ok([
      {
        tableId,
        entityType: 'field',
        entityId: fieldId,
        opKind: 'delete',
        beforeValue: beforeRes.value,
        afterValue: null,
      },
    ]);
  }
  return ok(null);
};

const enrichViewEventChanges = (
  event: BaseVcsTrackedEvent,
  prevTable: Table | undefined,
  nextTable: Table | undefined
): Result<IVcsChangeRowInput[] | null, DomainError> => {
  const tableId = event.tableId.toString();
  if (event instanceof ViewCreated) {
    const viewId = event.viewId.toString();
    const afterRes = safeViewSnapshot(nextTable, viewId);
    if (afterRes.isErr()) return err(afterRes.error);
    return ok([
      {
        tableId,
        entityType: 'view',
        entityId: viewId,
        opKind: 'create',
        beforeValue: null,
        afterValue: afterRes.value,
      },
    ]);
  }
  if (
    event instanceof ViewRenamed ||
    event instanceof ViewDescriptionUpdated ||
    event instanceof ViewFilterUpdated ||
    event instanceof ViewGroupUpdated ||
    event instanceof ViewSortUpdated ||
    event instanceof ViewOrderUpdated ||
    event instanceof ViewColumnMetaUpdated ||
    event instanceof ViewOptionsUpdated ||
    event instanceof ViewManualSortApplied
  ) {
    const viewId = event.viewId.toString();
    const beforeRes = safeViewSnapshot(prevTable, viewId);
    if (beforeRes.isErr()) return err(beforeRes.error);
    const afterRes = safeViewSnapshot(nextTable, viewId);
    if (afterRes.isErr()) return err(afterRes.error);
    return ok([
      {
        tableId,
        entityType: 'view',
        entityId: viewId,
        opKind: 'update',
        beforeValue: beforeRes.value,
        afterValue: afterRes.value,
      },
    ]);
  }
  if (event instanceof ViewDeleted) {
    const viewId = event.viewId.toString();
    const beforeRes = safeViewSnapshot(prevTable, viewId);
    if (beforeRes.isErr()) return err(beforeRes.error);
    return ok([
      {
        tableId,
        entityType: 'view',
        entityId: viewId,
        opKind: 'delete',
        beforeValue: beforeRes.value,
        afterValue: null,
      },
    ]);
  }
  return ok(null);
};

export const buildVcsChangesFromEvent = (
  event: BaseVcsTrackedEvent,
  tables: {
    readonly prevTable?: Table;
    readonly nextTable?: Table;
    readonly fallbackTable?: Table;
  }
): Result<IVcsChangeRowInput[], DomainError> => {
  const tableId = event.tableId.toString();

  const tableChangesRes = enrichTableEventChanges(event, tables.prevTable, tables.nextTable);
  if (tableChangesRes.isErr()) return err(tableChangesRes.error);
  if (tableChangesRes.value) return ok(tableChangesRes.value);

  const fieldChangesRes = enrichFieldEventChanges(event, tables.prevTable, tables.nextTable);
  if (fieldChangesRes.isErr()) return err(fieldChangesRes.error);
  if (fieldChangesRes.value) return ok(fieldChangesRes.value);

  const viewChangesRes = enrichViewEventChanges(event, tables.prevTable, tables.nextTable);
  if (viewChangesRes.isErr()) return err(viewChangesRes.error);
  if (viewChangesRes.value) return ok(viewChangesRes.value);

  const baseChanges = extractRecordDirtyKeys(event, tableId);
  if (baseChanges.length > 0) {
    const resolvedTable = tables.prevTable ?? tables.nextTable ?? tables.fallbackTable;
    if (resolvedTable) {
      const cascades = collectSymmetricRecordWriteCascadeChanges(resolvedTable, tableId, event);
      if (cascades.length > 0) {
        return ok([...baseChanges, ...cascades]);
      }
    }
  }
  return ok(baseChanges);
};
