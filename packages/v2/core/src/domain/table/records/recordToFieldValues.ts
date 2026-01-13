import type { RecordFieldValueDTO } from '../events/RecordFieldValuesDTO';
import type { TableRecord } from './TableRecord';

/**
 * Extracts field values from a TableRecord as DTOs for event payloads.
 */
export const recordToFieldValues = (record: TableRecord): RecordFieldValueDTO[] => {
  return record
    .fields()
    .entries()
    .map((entry) => ({
      fieldId: entry.fieldId.toString(),
      value: entry.value.toValue(),
    }));
};
