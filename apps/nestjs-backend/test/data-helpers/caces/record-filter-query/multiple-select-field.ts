import { hasAllOf, hasAnyOf, hasNoneOf, isEmpty, isExactly, isNotEmpty } from '@teable/core';

export const MULTIPLE_SELECT_FIELD_CASES = [
  {
    fieldIndex: 6,
    operator: isEmpty.value,
    queryValue: null,
    expectResultLength: 15,
    expectMoreResults: false,
  },
  {
    fieldIndex: 6,
    operator: isNotEmpty.value,
    queryValue: null,
    expectResultLength: 8,
    expectMoreResults: false,
  },
  {
    fieldIndex: 6,
    operator: hasAnyOf.value,
    queryValue: ['rap', 'rock', 'hiphop'],
    expectResultLength: 8,
    expectMoreResults: false,
  },
  {
    fieldIndex: 6,
    operator: hasAllOf.value,
    queryValue: ['rap', 'rock'],
    expectResultLength: 3,
    expectMoreResults: false,
  },
  {
    fieldIndex: 6,
    operator: hasNoneOf.value,
    queryValue: ['rock'],
    expectResultLength: 18,
    expectMoreResults: true,
  },
  {
    fieldIndex: 6,
    operator: isExactly.value,
    queryValue: ['rock', 'hiphop'],
    expectResultLength: 1,
    expectMoreResults: false,
  },
];
