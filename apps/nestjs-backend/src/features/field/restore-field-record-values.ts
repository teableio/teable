import { FieldKeyType, HttpErrorCode } from '@teable/core';
import type { IUpdateRecordsRo } from '@teable/openapi';
import { CustomHttpException } from '../../custom.exception';

export const FIELD_RESTORE_RECORD_CHUNK_SIZE = 500;

export type IFieldRestoreRecord = {
  id: string;
  fields?: Record<string, unknown> | null;
};

type IFieldRecordValueUpdater = {
  updateRecords(
    tableId: string,
    updateRecordsRo: Pick<IUpdateRecordsRo, 'fieldKeyType' | 'records'>
  ): Promise<unknown>;
};

const isEmptyRestoreValue = (value: unknown) => {
  return value == null || (Array.isArray(value) && value.length === 0);
};

export const compactFieldRestoreRecords = (records: IFieldRestoreRecord[] = []) => {
  return records.flatMap((record) => {
    const fields = Object.fromEntries(
      Object.entries(record.fields ?? {}).filter(([, value]) => !isEmptyRestoreValue(value))
    );

    return Object.keys(fields).length ? [{ id: record.id, fields }] : [];
  });
};

export const restoreFieldRecordValues = async (
  tableId: string,
  records: IFieldRestoreRecord[] | undefined,
  recordOpenApiService: IFieldRecordValueUpdater,
  chunkSize = FIELD_RESTORE_RECORD_CHUNK_SIZE
) => {
  const compactedRecords = compactFieldRestoreRecords(records);
  if (!compactedRecords.length) return;

  try {
    for (let i = 0; i < compactedRecords.length; i += chunkSize) {
      await recordOpenApiService.updateRecords(tableId, {
        fieldKeyType: FieldKeyType.Id,
        records: compactedRecords.slice(i, i + chunkSize),
      });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new CustomHttpException(
      `Failed to restore field cell values for table ${tableId}: ${message}`,
      HttpErrorCode.INTERNAL_SERVER_ERROR
    );
  }
};
