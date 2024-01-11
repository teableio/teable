import { contains, doesNotContain, is, isEmpty, isNot, isNotEmpty } from '@teable-group/core';

export const TEXT_FIELD_CASES = [
  {
    fieldIndex: 0,
    operator: isEmpty.value,
    queryValue: null,
    expectResultLength: 1,
    expectMoreResults: false,
  },
  {
    fieldIndex: 0,
    operator: isNotEmpty.value,
    queryValue: null,
    expectResultLength: 22,
    expectMoreResults: false,
  },
  {
    fieldIndex: 0,
    operator: is.value,
    queryValue: 'Text Field 0',
    expectResultLength: 1,
    expectMoreResults: false,
  },
  {
    fieldIndex: 0,
    operator: isNot.value,
    queryValue: 'Text Field 1',
    expectResultLength: 22,
    expectMoreResults: false,
  },
  {
    fieldIndex: 0,
    operator: contains.value,
    queryValue: 'Text',
    expectResultLength: 22,
    expectMoreResults: true,
  },
  {
    fieldIndex: 0,
    operator: doesNotContain.value,
    queryValue: 'Text',
    expectResultLength: 1,
    expectMoreResults: false,
  },
];
