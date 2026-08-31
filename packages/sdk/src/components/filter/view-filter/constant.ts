import {
  contains,
  doesNotContain,
  hasAllOf,
  hasAnyOf,
  hasNoneOf,
  isNotExactly,
  isNoneOf,
  isAnyOf,
  isEmpty,
  isNotEmpty,
} from '@teable/core';

const EMPTY_OPERATORS = [isEmpty.value, isNotEmpty.value] as string[];
const SINGLE_SELECT_ARRAY_OPERATORS = [isAnyOf.value, isNoneOf.value] as string[];
const MULTIPLE_SELECT_ARRAY_OPERATORS = [
  hasAnyOf.value,
  hasAllOf.value,
  hasNoneOf.value,
  isNotExactly.value,
] as string[];
const ARRAY_OPERATORS = [...SINGLE_SELECT_ARRAY_OPERATORS, ...MULTIPLE_SELECT_ARRAY_OPERATORS];
const LINK_TEXT_OPERATORS = [contains.value, doesNotContain.value] as string[];

export { EMPTY_OPERATORS, ARRAY_OPERATORS, LINK_TEXT_OPERATORS };
