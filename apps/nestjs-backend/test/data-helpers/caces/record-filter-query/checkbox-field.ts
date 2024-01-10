import { is } from '@teable-group/core';

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
