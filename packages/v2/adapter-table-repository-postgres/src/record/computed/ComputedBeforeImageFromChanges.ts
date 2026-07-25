import type { DomainError, FieldId, Table, TableId } from '@teable/v2-core';
import { RecordId } from '@teable/v2-core';
import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { StepChangeData } from './ComputedFieldUpdater';
import type { ComputedBeforeImageRecord } from './ComputedUpdatePlanner';

type BuildBeforeImageRecordsFromStepChangesParams = {
  seedTableId: TableId;
  seedRecordIds: ReadonlyArray<RecordId>;
  seedFieldIds: ReadonlyArray<FieldId>;
  changesByStep: ReadonlyArray<StepChangeData>;
  tableById: ReadonlyMap<string, Table>;
};

export const buildBeforeImageRecordsFromStepChanges = (
  params: BuildBeforeImageRecordsFromStepChangesParams
): Result<ReadonlyArray<ComputedBeforeImageRecord>, DomainError> => {
  if (
    params.seedRecordIds.length === 0 ||
    params.seedFieldIds.length === 0 ||
    params.changesByStep.length === 0
  ) {
    return ok([]);
  }

  const table = params.tableById.get(params.seedTableId.toString());
  if (!table) return ok([]);

  const dbFieldNameByFieldId = new Map<string, string>();
  for (const fieldId of params.seedFieldIds) {
    const fieldResult = table.getField((field) => field.id().equals(fieldId));
    if (fieldResult.isErr()) continue;

    const dbFieldNameResult = fieldResult.value.dbFieldName().andThen((name) => name.value());
    if (dbFieldNameResult.isErr()) continue;

    dbFieldNameByFieldId.set(fieldId.toString(), dbFieldNameResult.value);
  }

  if (dbFieldNameByFieldId.size === 0) return ok([]);

  const seedRecordIdSet = new Set(params.seedRecordIds.map((id) => id.toString()));
  const beforeImageByRecordId = new Map<string, Record<string, unknown>>();

  for (const stepChange of params.changesByStep) {
    if (stepChange.tableId !== params.seedTableId.toString()) continue;

    for (const recordChange of stepChange.recordChanges) {
      if (!seedRecordIdSet.has(recordChange.recordId)) continue;

      const fieldValuesByDbName = beforeImageByRecordId.get(recordChange.recordId) ?? {};
      for (const fieldChange of recordChange.changes) {
        const dbFieldName = dbFieldNameByFieldId.get(fieldChange.fieldId);
        if (!dbFieldName) continue;
        fieldValuesByDbName[dbFieldName] = fieldChange.oldValue;
      }

      if (Object.keys(fieldValuesByDbName).length > 0) {
        beforeImageByRecordId.set(recordChange.recordId, fieldValuesByDbName);
      }
    }
  }

  const records: ComputedBeforeImageRecord[] = [];
  for (const [recordId, fieldValuesByDbName] of beforeImageByRecordId) {
    const recordIdResult = RecordId.create(recordId);
    if (recordIdResult.isErr()) return err(recordIdResult.error);
    records.push({
      recordId: recordIdResult.value,
      fieldValuesByDbName,
    });
  }

  return ok(records);
};

/**
 * Merge before-image snapshots by record id, keeping the earliest value for each
 * db field name (existing wins over incoming for the same key).
 *
 * Used when chaining computed stages so filter-field old values captured on the
 * original user mutation are not dropped when later stages only see computed-field
 * change events.
 */
export const mergeBeforeImageRecords = (
  existing: ReadonlyArray<ComputedBeforeImageRecord>,
  incoming: ReadonlyArray<ComputedBeforeImageRecord>
): ComputedBeforeImageRecord[] => {
  const byRecordId = new Map<
    string,
    { recordId: ComputedBeforeImageRecord['recordId']; fields: Record<string, unknown> }
  >();

  const merge = (records: ReadonlyArray<ComputedBeforeImageRecord>): void => {
    for (const record of records) {
      const key = record.recordId.toString();
      const current = byRecordId.get(key);
      if (!current) {
        byRecordId.set(key, {
          recordId: record.recordId,
          fields: { ...record.fieldValuesByDbName },
        });
        continue;
      }

      for (const [dbFieldName, oldValue] of Object.entries(record.fieldValuesByDbName)) {
        if (!(dbFieldName in current.fields)) {
          current.fields[dbFieldName] = oldValue;
        }
      }
    }
  };

  merge(existing);
  merge(incoming);

  return [...byRecordId.values()].map(({ recordId, fields }) => ({
    recordId,
    fieldValuesByDbName: fields,
  }));
};
