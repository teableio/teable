import { is, isAnyOf, isEmpty, isNoneOf, isNot, isNotEmpty } from '@teable-group/core';

export const SINGLE_SELECT_FIELD_CASES = [
  {
    fieldIndex: 2,
    operator: isEmpty.value,
    queryValue: null,
    expectResultLength: 11,
    expectMoreResults: false,
  },
  {
    fieldIndex: 2,
    operator: isNotEmpty.value,
    queryValue: null,
    expectResultLength: 12,
    expectMoreResults: false,
  },
  {
    fieldIndex: 2,
    operator: is.value,
    queryValue: 'x',
    expectResultLength: 7,
    expectMoreResults: false,
  },
  {
    fieldIndex: 2,
    operator: isNot.value,
    queryValue: 'x',
    expectResultLength: 16,
    expectMoreResults: false,
  },
  {
    fieldIndex: 2,
    operator: isAnyOf.value,
    queryValue: ['x', 'y'],
    expectResultLength: 10,
    expectMoreResults: true,
  },
  {
    fieldIndex: 2,
    operator: isNoneOf.value,
    queryValue: ['x', 'y'],
    expectResultLength: 13,
    expectMoreResults: false,
  },
];
