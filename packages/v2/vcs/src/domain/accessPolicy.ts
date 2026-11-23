import type { DomainError, RecordQueryPluginScope, Table } from '@teable/v2-core';
import { err, ok, type Result } from 'neverthrow';

import { vcsDomainError } from './errors';
import { isStoredVcsField } from './fieldClassification';
import type {
  IBaseVcsPatch,
  IDeletedTableVcsPatch,
  ITableAccessScope,
  ITableVcsPatch,
} from './types';

export type VcsPatchAction =
  | 'table|create'
  | 'table|update'
  | 'table|delete'
  | 'field|create'
  | 'field|update'
  | 'field|delete'
  | 'view|create'
  | 'view|update'
  | 'view|delete'
  | 'record|create'
  | 'record|update'
  | 'record|delete';

export interface IVcsScopedTableDescriptor {
  readonly table: Table;
  readonly tableId: string;
  readonly readableFieldIds?: readonly string[];
  readonly isRowFiltered?: boolean;
  readonly queryScope?: RecordQueryPluginScope;
  readonly tableAccessScope?: ITableAccessScope;
}

const TABLE_PATCH_ACTIONS: ReadonlyArray<readonly [keyof ITableVcsPatch, VcsPatchAction]> = [
  ['nameChange', 'table|update'],
  ['fieldsAdded', 'field|create'],
  ['fieldsUpdated', 'field|update'],
  ['fieldsDeleted', 'field|delete'],
  ['viewsAdded', 'view|create'],
  ['viewsUpdated', 'view|update'],
  ['viewsDeleted', 'view|delete'],
  ['recordsAdded', 'record|create'],
  ['recordsUpdated', 'record|update'],
  ['recordsDeleted', 'record|delete'],
];

const hasTablePatchOps = (tp: ITableVcsPatch, key: keyof ITableVcsPatch): boolean => {
  const val = tp[key];
  return Array.isArray(val) ? val.length > 0 : val !== undefined;
};

export const collectVcsPatchWriteActions = (tp: ITableVcsPatch): VcsPatchAction[] =>
  TABLE_PATCH_ACTIONS.filter(([key]) => hasTablePatchOps(tp, key)).map(([, action]) => action);

export interface ICollectedVcsAddedIds {
  readonly tableIds: string[];
  readonly fieldIds: string[];
  readonly viewIds: string[];
}

export const collectVcsPatchAddedIds = (patch: IBaseVcsPatch): ICollectedVcsAddedIds => {
  const fieldIds = new Set<string>();
  const viewIds = new Set<string>();
  const addFields = (fields: ReadonlyArray<{ id: string; options?: Record<string, unknown> }>) => {
    for (const f of fields) {
      fieldIds.add(f.id);
      const symId = f.options?.symmetricFieldId;
      if (typeof symId === 'string' && symId) {
        fieldIds.add(symId);
      }
    }
  };
  for (const t of patch.tablesAdded) {
    addFields(t.fields);
    for (const v of t.views) viewIds.add(v.id);
  }
  for (const tp of patch.tablesUpdated) {
    addFields(tp.fieldsAdded);
    for (const v of tp.viewsAdded) viewIds.add(v.id);
  }
  return {
    tableIds: patch.tablesAdded.map((t) => t.id),
    fieldIds: [...fieldIds],
    viewIds: [...viewIds],
  };
};

export const buildAllowedVcsTableIdSet = (
  requestedIds?: readonly string[],
  shareVisibleIds?: ReadonlySet<string> | null
): Set<string> | undefined => {
  if (requestedIds && shareVisibleIds) {
    return new Set(requestedIds.filter((id) => shareVisibleIds.has(id)));
  }
  if (requestedIds) return new Set(requestedIds);
  if (shareVisibleIds) return new Set(shareVisibleIds);
  return undefined;
};

export const buildBlockedVcsTableScope = (
  table: Table,
  tableId: string
): IVcsScopedTableDescriptor => ({
  table,
  tableId,
  isRowFiltered: true,
  readableFieldIds: [],
  tableAccessScope: { tableId, readableFieldIds: [], isRowFiltered: true },
});

export const buildReadableVcsTableScope = (
  table: Table,
  tableId: string,
  qs: RecordQueryPluginScope | undefined
): IVcsScopedTableDescriptor => {
  const readableFieldIds = qs?.readableFieldIds
    ? [...new Set([...qs.readableFieldIds, ...(qs.forceReadableFieldIds ?? [])])].sort((a, b) =>
        a.localeCompare(b)
      )
    : undefined;
  const isRowFiltered = Boolean(
    (qs?.recordSpec && !qs.skipRecordSpec) || (qs?.fieldMasks?.length ?? 0) > 0
  );
  const tableAccessScope: ITableAccessScope | undefined =
    readableFieldIds || isRowFiltered
      ? {
          tableId,
          ...(readableFieldIds ? { readableFieldIds } : {}),
          ...(isRowFiltered ? { isRowFiltered: true } : {}),
        }
      : undefined;
  return {
    table,
    tableId,
    readableFieldIds,
    isRowFiltered,
    queryScope: qs,
    tableAccessScope,
  };
};

const findHiddenStoredFieldId = (
  table: Table,
  readableFieldIds: ReadonlySet<string>
): string | undefined => {
  for (const field of table.getFields()) {
    const stored = isStoredVcsField({
      type: field.type().toString(),
      isComputed: field.computed().toBoolean(),
    });
    if (stored && !readableFieldIds.has(field.id().toString())) {
      return field.id().toString();
    }
  }
  return undefined;
};

const findTouchedRestrictedFieldId = (
  tp: ITableVcsPatch,
  allowed: ReadonlySet<string>
): string | undefined => {
  const touched = [
    ...tp.fieldsUpdated.map((f) => f.fieldId),
    ...tp.fieldsDeleted.map((f) => f.fieldId),
    ...tp.recordsAdded.flatMap((r) => Object.keys(r.fields)),
    ...tp.recordsUpdated.flatMap((r) => r.cellChanges.map((c) => c.fieldId)),
  ];
  return touched.find((fid) => !allowed.has(fid));
};

export const assertVcsTableScopeAllowsMutation = (
  tp: ITableVcsPatch,
  scope: IVcsScopedTableDescriptor
): Result<void, DomainError> => {
  const recordOpCount =
    tp.recordsAdded.length + tp.recordsUpdated.length + tp.recordsDeleted.length;
  if (scope.isRowFiltered && recordOpCount > 0) {
    return err(
      vcsDomainError.forbidden({
        code: 'vcs.row_filtered_write_forbidden',
        message: `Cannot push record mutations to row-filtered table ${tp.tableId}`,
      })
    );
  }
  if (!scope.readableFieldIds) {
    return ok(undefined);
  }
  const allowed = new Set(scope.readableFieldIds);
  const deniedField = findTouchedRestrictedFieldId(tp, allowed);
  if (deniedField) {
    return err(
      vcsDomainError.forbidden({
        code: 'vcs.field_write_forbidden',
        message: `Cannot mutate restricted field ${deniedField}`,
      })
    );
  }
  if (tp.recordsDeleted.length > 0) {
    const hiddenStoredField = findHiddenStoredFieldId(scope.table, allowed);
    if (hiddenStoredField) {
      return err(
        vcsDomainError.forbidden({
          code: 'vcs.field_write_forbidden',
          message: `Cannot delete records in table ${tp.tableId} while field ${hiddenStoredField} is restricted`,
        })
      );
    }
  }
  return ok(undefined);
};

export const assertVcsTableScopeAllowsTableDelete = (
  delTable: IDeletedTableVcsPatch,
  scope: IVcsScopedTableDescriptor | undefined
): Result<void, DomainError> => {
  if (!scope) {
    return err(
      vcsDomainError.forbidden({
        code: 'vcs.filtered_table_delete_forbidden',
        message: `Cannot delete table ${delTable.tableId} without full readable scope`,
      })
    );
  }
  if (scope.isRowFiltered) {
    return err(
      vcsDomainError.forbidden({
        code: 'vcs.filtered_table_delete_forbidden',
        message: `Cannot delete row-filtered table ${delTable.tableId}`,
      })
    );
  }
  if (scope.readableFieldIds) {
    const allowed = new Set(scope.readableFieldIds);
    const hidden = scope.table.getFields().find((f) => !allowed.has(f.id().toString()));
    if (hidden) {
      return err(
        vcsDomainError.forbidden({
          code: 'vcs.filtered_table_delete_forbidden',
          message: `Cannot delete table ${delTable.tableId} while field ${hidden.id().toString()} is restricted`,
        })
      );
    }
  }
  return ok(undefined);
};
