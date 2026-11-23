import type { DomainError } from '@teable/v2-core';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { vcsDomainError } from './errors';
import {
  canonicalizeField,
  canonicalizeRecord,
  canonicalizeSnapshot,
  canonicalizeTable,
  canonicalizeView,
  cloneVcsValue,
} from './fieldClassification';
import type {
  IBaseVcsSnapshot,
  IFieldVcsSnapshot,
  IRecordVcsSnapshot,
  ITableVcsSnapshot,
  IVcsConflict,
  IVcsConflictResolution,
  IVcsMergeState,
  IViewVcsSnapshot,
} from './types';

function findTable(snapshot: IBaseVcsSnapshot, tableId: string): ITableVcsSnapshot | undefined {
  return snapshot.tables.find((t) => t.id === tableId);
}

function getChosenSideValue(
  conflict: IVcsConflict,
  resolution: IVcsConflictResolution
): Result<unknown, DomainError> {
  if (resolution.strategy === 'ours') {
    return ok(conflict.oursValue);
  }
  if (resolution.strategy === 'theirs') {
    return ok(conflict.theirsValue);
  }
  if (resolution.strategy === 'manual') {
    if (resolution.manualValue === undefined) {
      return err(
        vcsDomainError.validation({
          code: 'vcs.missing_manual_value',
          message: `Conflict ${conflict.id} uses strategy "manual" but manualValue is undefined`,
        })
      );
    }
    return ok(resolution.manualValue);
  }
  return err(
    vcsDomainError.validation({
      code: 'vcs.invalid_resolution_strategy',
      message: `Unsupported conflict resolution strategy: ${String(resolution.strategy)}`,
    })
  );
}

function upsertOrDeleteTable(
  tables: ITableVcsSnapshot[],
  tableId: string,
  nextTable: ITableVcsSnapshot | null | undefined
): void {
  const idx = tables.findIndex((t) => t.id === tableId);
  if (!nextTable) {
    if (idx >= 0) {
      tables.splice(idx, 1);
    }
    return;
  }
  const canonical = canonicalizeTable(cloneVcsValue(nextTable));
  if (idx >= 0) {
    tables[idx] = canonical;
  } else {
    tables.push(canonical);
  }
}

function stripFieldCellsFromRecords(
  records: readonly IRecordVcsSnapshot[],
  fieldId: string
): IRecordVcsSnapshot[] {
  return records.map((record) => {
    if (!Object.prototype.hasOwnProperty.call(record.fields, fieldId)) {
      return record;
    }
    const nextFields = { ...record.fields };
    delete nextFields[fieldId];
    return { ...record, fields: nextFields };
  });
}

function applyFieldResolution(
  table: ITableVcsSnapshot,
  conflict: IVcsConflict,
  chosen: unknown
): Result<ITableVcsSnapshot, DomainError> {
  const fields = [...table.fields];
  const idx = fields.findIndex((f) => f.id === conflict.entityId);

  if (chosen === null) {
    if (idx >= 0) {
      fields.splice(idx, 1);
    }
    return ok({
      ...table,
      fields,
      records: stripFieldCellsFromRecords(table.records, conflict.entityId),
    });
  }

  if (typeof chosen !== 'object' || chosen === null || Array.isArray(chosen)) {
    return err(
      vcsDomainError.validation({
        code: 'vcs.invalid_manual_field',
        message: `Expected field object or null for conflict ${conflict.id}`,
      })
    );
  }

  const baseField = (fields[idx] ??
    conflict.baseValue ??
    conflict.oursValue ??
    conflict.theirsValue) as Partial<IFieldVcsSnapshot> | undefined;
  const mergedField = canonicalizeField({
    id: conflict.entityId,
    name: baseField?.name ?? conflict.entityId,
    type: baseField?.type ?? 'singleLineText',
    isPrimary: baseField?.isPrimary ?? false,
    isComputed: baseField?.isComputed ?? false,
    ...(baseField ?? {}),
    ...(chosen as Partial<IFieldVcsSnapshot>),
  });

  if (idx >= 0) {
    fields[idx] = mergedField;
  } else {
    fields.push(mergedField);
  }

  return ok({
    ...table,
    fields,
  });
}

function applyViewResolution(
  table: ITableVcsSnapshot,
  conflict: IVcsConflict,
  chosen: unknown
): Result<ITableVcsSnapshot, DomainError> {
  const views = [...table.views];
  const idx = views.findIndex((v) => v.id === conflict.entityId);

  if (chosen === null) {
    if (idx >= 0) {
      views.splice(idx, 1);
    }
    return ok({ ...table, views });
  }

  if (typeof chosen !== 'object' || chosen === null || Array.isArray(chosen)) {
    return err(
      vcsDomainError.validation({
        code: 'vcs.invalid_manual_view',
        message: `Expected view object or null for conflict ${conflict.id}`,
      })
    );
  }

  const baseView = (views[idx] ??
    conflict.baseValue ??
    conflict.oursValue ??
    conflict.theirsValue) as Partial<IViewVcsSnapshot> | undefined;
  const mergedView = canonicalizeView({
    id: conflict.entityId,
    name: baseView?.name ?? conflict.entityId,
    type: baseView?.type ?? 'grid',
    ...(baseView ?? {}),
    ...(chosen as Partial<IViewVcsSnapshot>),
  });

  if (idx >= 0) {
    views[idx] = mergedView;
  } else {
    views.push(mergedView);
  }

  return ok({ ...table, views });
}

function applyRecordResolution(
  table: ITableVcsSnapshot,
  conflict: IVcsConflict,
  chosen: unknown
): Result<ITableVcsSnapshot, DomainError> {
  const records = [...table.records];
  const idx = records.findIndex((r) => r.id === conflict.entityId);

  if (chosen === null) {
    if (idx >= 0) {
      records.splice(idx, 1);
    }
    return ok({ ...table, records });
  }

  if (typeof chosen !== 'object' || chosen === null || Array.isArray(chosen)) {
    return err(
      vcsDomainError.validation({
        code: 'vcs.invalid_manual_record',
        message: `Expected record object or null for conflict ${conflict.id}`,
      })
    );
  }

  const chosenObj = chosen as Record<string, unknown>;
  const recordObj: IRecordVcsSnapshot =
    'fields' in chosenObj && typeof chosenObj.fields === 'object' && chosenObj.fields !== null
      ? {
          id: typeof chosenObj.id === 'string' ? chosenObj.id : conflict.entityId,
          fields: chosenObj.fields as Record<string, unknown>,
          ...(chosenObj.orders !== undefined
            ? { orders: chosenObj.orders as Record<string, number> }
            : {}),
        }
      : {
          id: conflict.entityId,
          fields: chosenObj,
        };

  const canonical = canonicalizeRecord(cloneVcsValue(recordObj), table.fields);
  if (idx >= 0) {
    records[idx] = canonical;
  } else {
    records.push(canonical);
  }

  return ok({ ...table, records });
}

function applyCellResolution(
  table: ITableVcsSnapshot,
  conflict: IVcsConflict,
  chosen: unknown
): Result<ITableVcsSnapshot, DomainError> {
  if (!conflict.fieldId) {
    return err(
      vcsDomainError.invariant({
        code: 'vcs.missing_conflict_field_id',
        message: `Cell or constraint conflict ${conflict.id} is missing fieldId`,
      })
    );
  }

  const records = [...table.records];
  const idx = records.findIndex((r) => r.id === conflict.entityId);
  const existing = idx >= 0 ? records[idx] : { id: conflict.entityId, fields: {} };
  const nextFields = { ...existing.fields };
  if (chosen === null || chosen === undefined) {
    delete nextFields[conflict.fieldId];
  } else {
    nextFields[conflict.fieldId] = cloneVcsValue(chosen);
  }

  const updatedRecord = canonicalizeRecord(
    {
      ...existing,
      fields: nextFields,
    },
    table.fields
  );

  if (idx >= 0) {
    records[idx] = updatedRecord;
  } else {
    records.push(updatedRecord);
  }

  return ok({ ...table, records });
}

function resolveTableConflictSide(
  mergeState: IVcsMergeState,
  conflict: IVcsConflict,
  resolution: IVcsConflictResolution,
  chosen: unknown
): ITableVcsSnapshot | null {
  if (resolution.strategy === 'ours') {
    return findTable(mergeState.oursSnapshot, conflict.tableId) ?? null;
  }
  if (resolution.strategy === 'theirs') {
    return findTable(mergeState.theirsSnapshot, conflict.tableId) ?? null;
  }
  return chosen as ITableVcsSnapshot | null;
}

function applySingleTableEntityResolution(
  table: ITableVcsSnapshot,
  conflict: IVcsConflict,
  chosen: unknown
): Result<ITableVcsSnapshot, DomainError> {
  switch (conflict.kind) {
    case 'field_delete_modify':
    case 'field_schema_conflict':
      return applyFieldResolution(table, conflict, chosen);
    case 'view_delete_modify':
    case 'view_schema_conflict':
      return applyViewResolution(table, conflict, chosen);
    case 'record_delete_modify':
      return applyRecordResolution(table, conflict, chosen);
    case 'cell_edit_edit':
    case 'constraint_conflict':
      return applyCellResolution(table, conflict, chosen);
  }
  return ok(table);
}

function applyConflictResolutionToTables(
  mergeState: IVcsMergeState,
  conflict: IVcsConflict,
  resolution: IVcsConflictResolution,
  workingTables: ITableVcsSnapshot[]
): Result<void, DomainError> {
  const chosenResult = getChosenSideValue(conflict, resolution);
  if (chosenResult.isErr()) {
    return err(chosenResult.error);
  }
  const chosen = chosenResult.value;

  if (conflict.kind === 'table_delete_modify') {
    upsertOrDeleteTable(
      workingTables,
      conflict.tableId,
      resolveTableConflictSide(mergeState, conflict, resolution, chosen)
    );
    return ok(undefined);
  }

  const tableIdx = workingTables.findIndex((t) => t.id === conflict.tableId);
  if (tableIdx < 0) {
    return err(
      vcsDomainError.notFound({
        code: 'vcs.conflict_table_not_found',
        message: `Cannot resolve conflict ${conflict.id}: table ${conflict.tableId} not found`,
      })
    );
  }

  const updatedResult = applySingleTableEntityResolution(workingTables[tableIdx], conflict, chosen);
  if (updatedResult.isErr()) {
    return err(updatedResult.error);
  }
  workingTables[tableIdx] = canonicalizeTable(updatedResult.value);
  return ok(undefined);
}

export function resolveConflicts(input: {
  mergeState: IVcsMergeState;
  resolutions: Record<string, IVcsConflictResolution>;
}): Result<
  { resolvedSnapshot: IBaseVcsSnapshot; remainingConflicts: readonly IVcsConflict[] },
  DomainError
> {
  const { mergeState, resolutions } = input;
  const workingTables = mergeState.workingSnapshot.tables.map((t) => cloneVcsValue(t));
  const remainingConflicts: IVcsConflict[] = [];

  for (const conflict of mergeState.conflicts) {
    const resolution = resolutions[conflict.id];
    if (!resolution) {
      remainingConflicts.push(conflict);
      continue;
    }

    const applyRes = applyConflictResolutionToTables(
      mergeState,
      conflict,
      resolution,
      workingTables
    );
    if (applyRes.isErr()) {
      return err(applyRes.error);
    }
  }

  return ok({
    resolvedSnapshot: canonicalizeSnapshot({
      ...mergeState.workingSnapshot,
      tables: workingTables,
    }),
    remainingConflicts,
  });
}
