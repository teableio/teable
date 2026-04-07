import type { IDeletedRecordSnapshot } from '../../domain/table/events/RecordsDeleted';
import type { Table } from '../../domain/table/Table';
import type { TableRecordReadModel } from '../../ports/TableRecordReadModel';
import { toTableRecord } from './toTableRecord';

export const buildDeletedRecordSnapshot = (
  table: Table,
  record: TableRecordReadModel
): IDeletedRecordSnapshot => {
  const tableRecordResult = toTableRecord(table, record);
  let displayName: string | undefined;
  if (tableRecordResult.isOk()) {
    const displayNameResult = tableRecordResult.value.displayName(table);
    if (displayNameResult.isOk() && displayNameResult.value) {
      displayName = displayNameResult.value;
    }
  }

  return {
    id: record.id,
    fields: record.fields,
    displayName,
    autoNumber: record.autoNumber,
    createdTime: record.createdTime,
    createdBy: record.createdBy,
    lastModifiedTime: record.lastModifiedTime,
    lastModifiedBy: record.lastModifiedBy,
    orders: record.orders,
  };
};
