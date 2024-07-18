import type { FieldType } from './constant';
import { NOT_NULL_VALIDATION_FIELD_TYPES, UNIQUE_VALIDATION_FIELD_TYPES } from './constant';

export const checkFieldValidationEnabled = (
  fieldType: FieldType,
  isLookup: boolean | null | undefined
) => {
  if (
    checkFieldUniqueValidationEnabled(fieldType, isLookup) ||
    checkFieldNotNullValidationEnabled(fieldType, isLookup)
  ) {
    return true;
  }
  return false;
};

export const checkFieldUniqueValidationEnabled = (
  fieldType: FieldType,
  isLookup: boolean | null | undefined
) => {
  if (isLookup || !UNIQUE_VALIDATION_FIELD_TYPES.has(fieldType)) {
    return false;
  }
  return true;
};

export const checkFieldNotNullValidationEnabled = (
  fieldType: FieldType,
  isLookup: boolean | null | undefined
) => {
  if (isLookup || !NOT_NULL_VALIDATION_FIELD_TYPES.has(fieldType)) {
    return false;
  }
  return true;
};
