import type { IDeletedRecordSnapshot } from '../../domain/table/events/RecordsDeleted';
import type { Table } from '../../domain/table/Table';
import type { TableRecordReadModel } from '../../ports/TableRecordReadModel';
import type { RecordStoredSnapshot } from '../../ports/TableRecordRepository';
import { toTableRecord } from './toTableRecord';

const isRecordStoredSnapshot = (
  record: TableRecordReadModel | RecordStoredSnapshot
): record is RecordStoredSnapshot => {
  return 'recordId' in record && !('id' in record);
};

export const buildDeletedRecordSnapshot = (
  table: Table,
  record: TableRecordReadModel | RecordStoredSnapshot
): IDeletedRecordSnapshot => {
  const snapshotVersion = record.version;
  const normalizedRecord: TableRecordReadModel = isRecordStoredSnapshot(record)
    ? {
        id: record.recordId,
        fields: record.fields,
        // toTableRecord expects a read-model version number. Preserve the
        // original snapshot version separately so the event payload does not
        // invent a version when the repository omitted one.
        version: record.version ?? 0,
        autoNumber: record.autoNumber,
        createdTime: record.createdTime,
        createdBy: record.createdBy,
        lastModifiedTime: record.lastModifiedTime,
        lastModifiedBy: record.lastModifiedBy,
        orders: record.orders,
      }
    : record;

  const tableRecordResult = toTableRecord(table, normalizedRecord);
  let displayName: string | undefined;
  if (tableRecordResult.isOk()) {
    const displayNameResult = tableRecordResult.value.displayName(table);
    if (displayNameResult.isOk() && displayNameResult.value) {
      displayName = displayNameResult.value;
    }
  }

  return {
    id: normalizedRecord.id,
    fields: normalizedRecord.fields,
    ...(snapshotVersion !== undefined ? { version: snapshotVersion } : {}),
    displayName,
    autoNumber: normalizedRecord.autoNumber,
    createdTime: normalizedRecord.createdTime,
    createdBy: normalizedRecord.createdBy,
    lastModifiedTime: normalizedRecord.lastModifiedTime,
    lastModifiedBy: normalizedRecord.lastModifiedBy,
    orders: normalizedRecord.orders,
  };
};
