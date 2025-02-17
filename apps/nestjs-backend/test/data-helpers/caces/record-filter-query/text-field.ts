import { contains, doesNotContain, is, isEmpty, isNot, isNotEmpty } from '@teable/core';

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
  // test lower case
  {
    fieldIndex: 0,
    operator: is.value,
    queryValue: 'Text field 0',
    expectResultLength: 1,
    expectMoreResults: false,
  },
  {
    fieldIndex: 0,
    operator: isNot.value,
    queryValue: 'Text field 1',
    expectResultLength: 22,
    expectMoreResults: false,
  },
  {
    fieldIndex: 0,
    operator: contains.value,
    queryValue: 'text',
    expectResultLength: 22,
    expectMoreResults: true,
  },
  {
    fieldIndex: 0,
    operator: doesNotContain.value,
    queryValue: 'text',
    expectResultLength: 1,
    expectMoreResults: false,
  },
];

export const TEXT_LOOKUP_FIELD_CASES = [
  {
    fieldIndex: 3,
    operator: isEmpty.value,
    queryValue: null,
    expectResultLength: 7,
    expectMoreResults: false,
  },
  {
    fieldIndex: 3,
    operator: isNotEmpty.value,
    queryValue: null,
    expectResultLength: 14,
    expectMoreResults: false,
  },
  {
    fieldIndex: 3,
    operator: is.value,
    queryValue: 'Text Field 0',
    expectResultLength: 5,
    expectMoreResults: false,
  },
  {
    fieldIndex: 3,
    operator: isNot.value,
    queryValue: 'Text Field 1',
    expectResultLength: 16,
    expectMoreResults: true,
  },
  {
    fieldIndex: 3,
    operator: contains.value,
    queryValue: 'Text',
    expectResultLength: 14,
    expectMoreResults: true,
  },
  {
    fieldIndex: 3,
    operator: doesNotContain.value,
    queryValue: 'Text',
    expectResultLength: 7,
    expectMoreResults: false,
  },
  // ignore case test
  {
    fieldIndex: 3,
    operator: is.value,
    queryValue: 'Text field 0',
    expectResultLength: 5,
    expectMoreResults: false,
  },
  {
    fieldIndex: 3,
    operator: isNot.value,
    queryValue: 'Text field 1',
    expectResultLength: 16,
    expectMoreResults: true,
  },
  {
    fieldIndex: 3,
    operator: contains.value,
    queryValue: 'text',
    expectResultLength: 14,
    expectMoreResults: true,
  },
  {
    fieldIndex: 3,
    operator: doesNotContain.value,
    queryValue: 'text',
    expectResultLength: 7,
    expectMoreResults: false,
  },
];
