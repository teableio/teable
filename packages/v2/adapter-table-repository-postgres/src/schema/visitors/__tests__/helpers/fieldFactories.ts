/* eslint-disable regexp/use-ignore-case */
import type { DomainError, Field } from '@teable/v2-core';
import {
  DbFieldName,
  FieldId,
  FieldName,
  FieldNotNull,
  FieldUnique,
  createSingleLineTextField,
  createNumberField,
  createRatingField,
  createCheckboxField,
  createDateField,
  createSingleSelectField,
  createMultipleSelectField,
  createUserField,
  createAttachmentField,
  createButtonField,
  RatingMax,
  UserMultiplicity,
} from '@teable/v2-core';
import { err } from 'neverthrow';
import type { Result } from 'neverthrow';

/**
 * Sanitize ID seed to ensure valid characters.
 */
const sanitizeIdSeed = (seed: string): string => seed.replace(/[^0-9a-zA-Z]/g, '0');

/**
 * Create a valid field ID (format: fld + 16 chars).
 */
export const createValidFieldId = (seed: string): string =>
  `fld${sanitizeIdSeed(seed).padEnd(16, '0').slice(0, 16)}`;

/**
 * Options for creating fields.
 */
interface FieldCreateOptions {
  notNull?: boolean;
  unique?: boolean;
}

/**
 * Helper to set dbFieldName on a field result.
 */
const setDbFieldName = (
  fieldResult: Result<Field, DomainError>,
  dbFieldName: string
): Result<Field, DomainError> => {
  if (fieldResult.isErr()) return fieldResult;

  const dbFieldResult = DbFieldName.rehydrate(dbFieldName);
  if (dbFieldResult.isErr()) return err(dbFieldResult.error);

  const setResult = fieldResult.value.setDbFieldName(dbFieldResult.value);
  if (setResult.isErr()) return err(setResult.error);

  return fieldResult;
};

/**
 * Create a SingleLineText field with dbFieldName set.
 */
export const createTextField = (
  id: string,
  name: string,
  dbFieldName: string,
  options: FieldCreateOptions = {}
): Result<Field, DomainError> => {
  const fieldIdResult = FieldId.create(createValidFieldId(id));
  if (fieldIdResult.isErr()) return err(fieldIdResult.error);

  const fieldNameResult = FieldName.create(name);
  if (fieldNameResult.isErr()) return err(fieldNameResult.error);

  const notNull = options.notNull ? FieldNotNull.required() : FieldNotNull.optional();
  const unique = options.unique ? FieldUnique.enabled() : FieldUnique.disabled();

  const fieldResult = createSingleLineTextField({
    id: fieldIdResult.value,
    name: fieldNameResult.value,
    notNull,
    unique,
  });

  return setDbFieldName(fieldResult, dbFieldName);
};

/**
 * Create a Number field with dbFieldName set.
 */
export const createNumField = (
  id: string,
  name: string,
  dbFieldName: string,
  options: FieldCreateOptions = {}
): Result<Field, DomainError> => {
  const fieldIdResult = FieldId.create(createValidFieldId(id));
  if (fieldIdResult.isErr()) return err(fieldIdResult.error);

  const fieldNameResult = FieldName.create(name);
  if (fieldNameResult.isErr()) return err(fieldNameResult.error);

  const notNull = options.notNull ? FieldNotNull.required() : FieldNotNull.optional();
  const unique = options.unique ? FieldUnique.enabled() : FieldUnique.disabled();

  const fieldResult = createNumberField({
    id: fieldIdResult.value,
    name: fieldNameResult.value,
    notNull,
    unique,
  });

  return setDbFieldName(fieldResult, dbFieldName);
};

/**
 * Create a Rating field with dbFieldName set.
 */
export const createRatField = (
  id: string,
  name: string,
  dbFieldName: string,
  max: number = 5
): Result<Field, DomainError> => {
  const fieldIdResult = FieldId.create(createValidFieldId(id));
  if (fieldIdResult.isErr()) return err(fieldIdResult.error);

  const fieldNameResult = FieldName.create(name);
  if (fieldNameResult.isErr()) return err(fieldNameResult.error);

  const maxResult = RatingMax.create(max);
  if (maxResult.isErr()) return err(maxResult.error);

  const fieldResult = createRatingField({
    id: fieldIdResult.value,
    name: fieldNameResult.value,
    max: maxResult.value,
  });

  return setDbFieldName(fieldResult, dbFieldName);
};

/**
 * Create a Checkbox field with dbFieldName set.
 */
export const createCheckField = (
  id: string,
  name: string,
  dbFieldName: string
): Result<Field, DomainError> => {
  const fieldIdResult = FieldId.create(createValidFieldId(id));
  if (fieldIdResult.isErr()) return err(fieldIdResult.error);

  const fieldNameResult = FieldName.create(name);
  if (fieldNameResult.isErr()) return err(fieldNameResult.error);

  const fieldResult = createCheckboxField({
    id: fieldIdResult.value,
    name: fieldNameResult.value,
  });

  return setDbFieldName(fieldResult, dbFieldName);
};

/**
 * Create a Date field with dbFieldName set.
 */
export const createDtField = (
  id: string,
  name: string,
  dbFieldName: string
): Result<Field, DomainError> => {
  const fieldIdResult = FieldId.create(createValidFieldId(id));
  if (fieldIdResult.isErr()) return err(fieldIdResult.error);

  const fieldNameResult = FieldName.create(name);
  if (fieldNameResult.isErr()) return err(fieldNameResult.error);

  const fieldResult = createDateField({
    id: fieldIdResult.value,
    name: fieldNameResult.value,
  });

  return setDbFieldName(fieldResult, dbFieldName);
};

/**
 * Create a SingleSelect field with dbFieldName set.
 */
export const createSingleSelField = (
  id: string,
  name: string,
  dbFieldName: string
): Result<Field, DomainError> => {
  const fieldIdResult = FieldId.create(createValidFieldId(id));
  if (fieldIdResult.isErr()) return err(fieldIdResult.error);

  const fieldNameResult = FieldName.create(name);
  if (fieldNameResult.isErr()) return err(fieldNameResult.error);

  const fieldResult = createSingleSelectField({
    id: fieldIdResult.value,
    name: fieldNameResult.value,
    options: [],
  });

  return setDbFieldName(fieldResult, dbFieldName);
};

/**
 * Create a MultipleSelect field with dbFieldName set.
 */
export const createMultiSelField = (
  id: string,
  name: string,
  dbFieldName: string
): Result<Field, DomainError> => {
  const fieldIdResult = FieldId.create(createValidFieldId(id));
  if (fieldIdResult.isErr()) return err(fieldIdResult.error);

  const fieldNameResult = FieldName.create(name);
  if (fieldNameResult.isErr()) return err(fieldNameResult.error);

  const fieldResult = createMultipleSelectField({
    id: fieldIdResult.value,
    name: fieldNameResult.value,
    options: [],
  });

  return setDbFieldName(fieldResult, dbFieldName);
};

/**
 * Create a User field with dbFieldName set.
 */
export const createUsrField = (
  id: string,
  name: string,
  dbFieldName: string,
  isMultiple: boolean = false
): Result<Field, DomainError> => {
  const fieldIdResult = FieldId.create(createValidFieldId(id));
  if (fieldIdResult.isErr()) return err(fieldIdResult.error);

  const fieldNameResult = FieldName.create(name);
  if (fieldNameResult.isErr()) return err(fieldNameResult.error);

  const multiplicity = isMultiple ? UserMultiplicity.multiple() : UserMultiplicity.single();

  const fieldResult = createUserField({
    id: fieldIdResult.value,
    name: fieldNameResult.value,
    isMultiple: multiplicity,
  });

  return setDbFieldName(fieldResult, dbFieldName);
};

/**
 * Create an Attachment field with dbFieldName set.
 */
export const createAttField = (
  id: string,
  name: string,
  dbFieldName: string
): Result<Field, DomainError> => {
  const fieldIdResult = FieldId.create(createValidFieldId(id));
  if (fieldIdResult.isErr()) return err(fieldIdResult.error);

  const fieldNameResult = FieldName.create(name);
  if (fieldNameResult.isErr()) return err(fieldNameResult.error);

  const fieldResult = createAttachmentField({
    id: fieldIdResult.value,
    name: fieldNameResult.value,
  });

  return setDbFieldName(fieldResult, dbFieldName);
};

/**
 * Create a Button field with dbFieldName set.
 */
export const createBtnField = (
  id: string,
  name: string,
  dbFieldName: string
): Result<Field, DomainError> => {
  const fieldIdResult = FieldId.create(createValidFieldId(id));
  if (fieldIdResult.isErr()) return err(fieldIdResult.error);

  const fieldNameResult = FieldName.create(name);
  if (fieldNameResult.isErr()) return err(fieldNameResult.error);

  const fieldResult = createButtonField({
    id: fieldIdResult.value,
    name: fieldNameResult.value,
  });

  return setDbFieldName(fieldResult, dbFieldName);
};
