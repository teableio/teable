import type { RecordFieldValueDTO } from '../../domain/table/events/RecordFieldValuesDTO';

export const mergeRecordFieldValues = (
  fieldValues: ReadonlyArray<RecordFieldValueDTO>,
  changedFields?: ReadonlyMap<string, unknown>
): ReadonlyArray<RecordFieldValueDTO> => {
  if (!changedFields || changedFields.size === 0) {
    return fieldValues;
  }

  const merged = new Map(fieldValues.map((fieldValue) => [fieldValue.fieldId, fieldValue.value]));
  for (const [fieldId, value] of changedFields) {
    merged.set(fieldId, value);
  }

  return [...merged.entries()].map(([fieldId, value]) => ({ fieldId, value }));
};
