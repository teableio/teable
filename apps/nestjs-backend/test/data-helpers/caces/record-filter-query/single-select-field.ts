import {
  is,
  isAnyOf,
  isEmpty,
  isNoneOf,
  isNot,
  isNotEmpty,
  hasAllOf,
  hasAnyOf,
  hasNoneOf,
  isExactly,
} from '@teable/core';

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

export const SINGLE_SELECT_LOOKUP_FIELD_CASES = [
  {
    fieldIndex: 5,
    operator: isEmpty.value,
    queryValue: null,
    expectResultLength: 15,
    expectMoreResults: false,
  },
  {
    fieldIndex: 5,
    operator: isNotEmpty.value,
    queryValue: null,
    expectResultLength: 6,
    expectMoreResults: false,
  },
  {
    fieldIndex: 5,
    operator: hasAnyOf.value,
    queryValue: ['x'],
    expectResultLength: 5,
    expectMoreResults: false,
  },
  {
    fieldIndex: 5,
    operator: hasAllOf.value,
    queryValue: ['x'],
    expectResultLength: 5,
    expectMoreResults: false,
  },
  {
    fieldIndex: 5,
    operator: hasNoneOf.value,
    queryValue: ['x'],
    expectResultLength: 16,
    expectMoreResults: true,
  },
  {
    fieldIndex: 5,
    operator: isExactly.value,
    queryValue: ['x'],
    expectResultLength: 4,
    expectMoreResults: false,
  },
];
