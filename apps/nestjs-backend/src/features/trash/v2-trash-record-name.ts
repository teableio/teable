import {
  FieldId,
  RecordId,
  TableRecord,
  TableRecordCellValue,
  err,
  type DomainError,
  type Result,
  type Table,
} from '@teable/v2-core';

export interface IV2TrashRecordSnapshotLike {
  id: string;
  fields: Record<string, unknown>;
}

const buildTableRecordFromSnapshot = (
  table: Table,
  snapshot: IV2TrashRecordSnapshotLike
): Result<TableRecord, DomainError> => {
  const recordIdResult = RecordId.create(snapshot.id);
  if (recordIdResult.isErr()) {
    return err(recordIdResult.error);
  }

  const fieldValues: Array<{ fieldId: FieldId; value: TableRecordCellValue }> = [];
  for (const [fieldIdRaw, rawValue] of Object.entries(snapshot.fields)) {
    const fieldIdResult = FieldId.create(fieldIdRaw);
    if (fieldIdResult.isErr()) {
      return err(fieldIdResult.error);
    }

    const cellValueResult = TableRecordCellValue.create(rawValue);
    if (cellValueResult.isErr()) {
      return err(cellValueResult.error);
    }

    fieldValues.push({
      fieldId: fieldIdResult.value,
      value: cellValueResult.value,
    });
  }

  return TableRecord.create({
    id: recordIdResult.value,
    tableId: table.id(),
    fieldValues,
  });
};

export const resolveV2TrashRecordDisplayName = (
  table: Table,
  snapshot: IV2TrashRecordSnapshotLike
): Result<string | null, DomainError> => {
  return buildTableRecordFromSnapshot(table, snapshot).andThen((record) =>
    record.displayName(table)
  );
};
