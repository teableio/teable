import {
  hasAllOf,
  hasAnyOf,
  hasNoneOf,
  isNotExactly,
  isEmpty,
  isExactly,
  isNotEmpty,
} from '@teable/core';

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
  {
    fieldIndex: 6,
    operator: isNotExactly.value,
    queryValue: ['rap', 'rock'],
    expectResultLength: 22,
    expectMoreResults: true,
  },
];

export const MULTIPLE_SELECT_LOOKUP_FIELD_CASES = [
  {
    fieldIndex: 9,
    operator: isEmpty.value,
    queryValue: null,
    expectResultLength: 11,
    expectMoreResults: false,
  },
  {
    fieldIndex: 9,
    operator: isNotEmpty.value,
    queryValue: null,
    expectResultLength: 10,
    expectMoreResults: false,
  },
  {
    fieldIndex: 9,
    operator: hasAnyOf.value,
    queryValue: ['rap', 'rock', 'hiphop'],
    expectResultLength: 10,
    expectMoreResults: false,
  },
  {
    fieldIndex: 9,
    operator: hasAllOf.value,
    queryValue: ['rap', 'rock'],
    expectResultLength: 8,
    expectMoreResults: false,
  },
  {
    fieldIndex: 9,
    operator: hasNoneOf.value,
    queryValue: ['rock'],
    expectResultLength: 12,
    expectMoreResults: true,
  },
  {
    fieldIndex: 9,
    operator: isExactly.value,
    queryValue: ['rock', 'hiphop'],
    expectResultLength: 1,
    expectMoreResults: false,
  },
  {
    fieldIndex: 9,
    operator: isNotExactly.value,
    queryValue: ['rap'],
    expectResultLength: 20,
    expectMoreResults: false,
  },
];
