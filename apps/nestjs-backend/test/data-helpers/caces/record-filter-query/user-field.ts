import { is, isAnyOf, isEmpty, isNoneOf, isNot, isNotEmpty } from '@teable-group/core';

export const USER_FIELD_CASES = [
  {
    fieldIndex: 5,
    operator: isEmpty.value,
    queryValue: null,
    expectResultLength: 22,
    expectMoreResults: false,
  },
  {
    fieldIndex: 5,
    operator: isNotEmpty.value,
    queryValue: null,
    expectResultLength: 1,
    expectMoreResults: false,
  },
  {
    fieldIndex: 5,
    operator: is.value,
    queryValue: 'usrTestUserId',
    expectResultLength: 1,
    expectMoreResults: false,
  },
  {
    fieldIndex: 5,
    operator: isNot.value,
    queryValue: 'usrTestUserId',
    expectResultLength: 22,
    expectMoreResults: false,
  },
  {
    fieldIndex: 5,
    operator: isAnyOf.value,
    queryValue: ['usrTestUserId'],
    expectResultLength: 1,
    expectMoreResults: true,
  },
  {
    fieldIndex: 5,
    operator: isNoneOf.value,
    queryValue: ['usrTestUserId'],
    expectResultLength: 22,
    expectMoreResults: false,
  },
];
