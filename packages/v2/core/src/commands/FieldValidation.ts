import type { fieldTypeValues } from '../domain/table/fields/FieldType';

export type FieldTypeValue = (typeof fieldTypeValues)[number];

const computedFieldTypes = new Set<FieldTypeValue>([
  'formula',
  'rollup',
  'createdTime',
  'lastModifiedTime',
  'createdBy',
  'lastModifiedBy',
  'autoNumber',
  'conditionalRollup',
  'conditionalLookup',
]);

const uniqueValidationFieldTypes = new Set<FieldTypeValue>([
  'singleLineText',
  'longText',
  'number',
  'date',
]);

const notNullValidationFieldTypes = new Set<FieldTypeValue>([
  'singleLineText',
  'longText',
  'number',
  'singleSelect',
  'multipleSelect',
  'user',
  'date',
  'rating',
  'attachment',
  'link',
]);

export const isComputedFieldType = (fieldType: FieldTypeValue): boolean =>
  computedFieldTypes.has(fieldType);

export const checkFieldUniqueValidationEnabled = (
  fieldType: FieldTypeValue,
  options?: { isLookup?: boolean; isComputed?: boolean }
): boolean => {
  const isComputed = options?.isComputed ?? isComputedFieldType(fieldType);
  if (options?.isLookup || isComputed) return false;
  return uniqueValidationFieldTypes.has(fieldType);
};

export const checkFieldNotNullValidationEnabled = (
  fieldType: FieldTypeValue,
  options?: { isLookup?: boolean; isComputed?: boolean }
): boolean => {
  const isComputed = options?.isComputed ?? isComputedFieldType(fieldType);
  if (options?.isLookup || isComputed) return false;
  return notNullValidationFieldTypes.has(fieldType);
};
