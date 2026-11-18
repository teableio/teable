import type { Field } from './Field';
import { FieldType } from './FieldType';
import type { ConditionalLookupField } from './types/ConditionalLookupField';
import type { LookupField } from './types/LookupField';

export type UserFilterMultiplicityChange = 'singleToMultiple' | 'multipleToSingle';

const USER_FILTER_ARRAY_OPERATORS: Record<string, true> = {
  isAnyOf: true,
  isNoneOf: true,
  hasAnyOf: true,
  hasAllOf: true,
  hasNoneOf: true,
  isExactly: true,
  isNotExactly: true,
};

const USER_SINGLE_TO_MULTIPLE_OPERATORS: Record<string, string> = {
  is: 'isExactly',
  isNot: 'isNotExactly',
  isAnyOf: 'hasAnyOf',
  isNoneOf: 'hasNoneOf',
  isEmpty: 'isEmpty',
  isNotEmpty: 'isNotEmpty',
};

const USER_MULTIPLE_TO_SINGLE_OPERATORS: Record<string, string> = {
  isExactly: 'is',
  isNotExactly: 'isNot',
  hasAnyOf: 'isAnyOf',
  hasNoneOf: 'isNoneOf',
  is: 'is',
  isNot: 'isNot',
  isEmpty: 'isEmpty',
  isNotEmpty: 'isNotEmpty',
};

export const isFieldReferenceFilterValue = (value: unknown): boolean => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('type' in value)) {
    return false;
  }
  return value.type === 'field';
};

/** The filter value that stands for the reader on a user-valued Field. */
export const currentUserFilterValue = 'Me';

/** A user-valued Field, seen through lookups: `Me` in a filter on it stands for the reader. */
export const isUserLikeField = (field: Field): boolean => {
  const type = field.type();
  if (type.equals(FieldType.lookup()) || type.equals(FieldType.conditionalLookup())) {
    // Type-only: a runtime import of the lookup classes would cycle back through FieldCondition.
    const lookup = field as LookupField | ConditionalLookupField;
    const inner = lookup.innerField();
    return inner.isOk() && isUserLikeField(inner.value);
  }
  return (
    type.equals(FieldType.user()) ||
    type.equals(FieldType.createdBy()) ||
    type.equals(FieldType.lastModifiedBy())
  );
};

/** Replaces `Me` in a user filter value, single or list, with `userId`. */
export const replaceCurrentUserFilterValue = <T>(value: T, userId: string): T =>
  (Array.isArray(value)
    ? value.map((item) => (item === currentUserFilterValue ? userId : item))
    : value === currentUserFilterValue
      ? userId
      : value) as T;

export const remapUserFilterOperator = (
  operator: string,
  value: unknown,
  change: UserFilterMultiplicityChange
): { operator: string; value: unknown; changed: boolean } | null => {
  const nextOperator =
    change === 'multipleToSingle' && operator === 'hasAllOf'
      ? 'is'
      : change === 'singleToMultiple'
        ? USER_SINGLE_TO_MULTIPLE_OPERATORS[operator]
        : USER_MULTIPLE_TO_SINGLE_OPERATORS[operator];
  if (!nextOperator) {
    return null;
  }
  if (nextOperator === operator) {
    return { operator, value, changed: false };
  }
  if (nextOperator === 'isEmpty' || nextOperator === 'isNotEmpty') {
    return { operator: nextOperator, value, changed: true };
  }
  if (isFieldReferenceFilterValue(value)) {
    return { operator: nextOperator, value, changed: true };
  }
  if (USER_FILTER_ARRAY_OPERATORS[nextOperator]) {
    if (Array.isArray(value)) {
      return { operator: nextOperator, value, changed: true };
    }
    if (value == null) {
      return null;
    }
    return { operator: nextOperator, value: [value], changed: true };
  }
  if (Array.isArray(value)) {
    if (value.length !== 1) {
      return null;
    }
    return { operator: nextOperator, value: value[0], changed: true };
  }
  return { operator: nextOperator, value, changed: true };
};
