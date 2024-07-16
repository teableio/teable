import { is } from '@teable/core';

export const CHECKBOX_FIELD_CASES = [
  {
    fieldIndex: 4,
    operator: is.value,
    queryValue: null,
    expectResultLength: 19,
    expectMoreResults: false,
  },
  {
    fieldIndex: 4,
    operator: is.value,
    queryValue: true,
    expectResultLength: 4,
    expectMoreResults: false,
  },
];

export const CHECKBOX_LOOKUP_FIELD_CASES = [
  {
    fieldIndex: 7,
    operator: is.value,
    queryValue: null,
    expectResultLength: 14,
    expectMoreResults: false,
  },
  {
    fieldIndex: 7,
    operator: is.value,
    queryValue: true,
    expectResultLength: 7,
    expectMoreResults: false,
  },
];
