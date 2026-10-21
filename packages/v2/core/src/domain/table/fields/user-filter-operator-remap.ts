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
