import { err } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import { FieldId } from '../../domain/table/fields/FieldId';
import { RecordId } from '../../domain/table/records/RecordId';
import { TableRecord } from '../../domain/table/records/TableRecord';
import { TableRecordCellValue } from '../../domain/table/records/TableRecordFields';
import type { Table } from '../../domain/table/Table';
import type { TableRecordReadModel } from '../../ports/TableRecordReadModel';

export const toTableRecord = (
  table: Table,
  readModel: TableRecordReadModel
): Result<TableRecord, DomainError> => {
  const recordIdResult = RecordId.create(readModel.id);
  if (recordIdResult.isErr()) {
    return err(recordIdResult.error);
  }

  const fieldValues: Array<{
    fieldId: FieldId;
    value: TableRecordCellValue;
  }> = [];

  for (const [fieldIdText, rawValue] of Object.entries(readModel.fields)) {
    const fieldIdResult = FieldId.create(fieldIdText);
    if (fieldIdResult.isErr()) {
      continue;
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
