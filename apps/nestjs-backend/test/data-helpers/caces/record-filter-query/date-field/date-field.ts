import { isEmpty, isNotEmpty } from '@teable/core';
import { IS_AFTER_SETS, LOOKUP_IS_AFTER_SETS } from './is-after-sets';
import { IS_BEFORE_SETS, LOOKUP_IS_BEFORE_SETS } from './is-before-sets';
import { IS_NOT_SETS, LOOKUP_IS_NOT_SETS } from './is-not-sets';
import { IS_ON_OR_AFTER_SETS, LOOKUP_IS_ON_OR_AFTER_SETS } from './is-on-or-after-sets';
import { IS_ON_OR_BEFORE_SETS, LOOKUP_IS_ON_OR_BEFORE_SETS } from './is-on-or-before-sets';
import { IS_SETS, LOOKUP_IS_SETS } from './is-sets';
import { IS_WITH_IN_SETS, LOOKUP_IS_WITH_IN_SETS } from './is-with-in-sets';

export const DATE_FIELD_CASES = [
  {
    fieldIndex: 3,
    operator: isEmpty.value,
    queryValue: null,
    expectResultLength: 6,
  },
  {
    fieldIndex: 3,
    operator: isNotEmpty.value,
    queryValue: null,
    expectResultLength: 17,
  },
  ...IS_SETS,
  ...IS_NOT_SETS,
  ...IS_WITH_IN_SETS,
  ...IS_BEFORE_SETS,
  ...IS_AFTER_SETS,
  ...IS_ON_OR_BEFORE_SETS,
  ...IS_ON_OR_AFTER_SETS,
];

export const DATE_LOOKUP_FIELD_CASES = [
  {
    fieldIndex: 6,
    operator: isEmpty.value,
    queryValue: null,
    expectResultLength: 7,
  },
  {
    fieldIndex: 6,
    operator: isNotEmpty.value,
    queryValue: null,
    expectResultLength: 14,
  },
  ...LOOKUP_IS_SETS.map((testCase) => ({ ...testCase, fieldIndex: testCase.fieldIndex ?? 6 })),
  ...LOOKUP_IS_NOT_SETS.map((testCase) => ({ ...testCase, fieldIndex: testCase.fieldIndex ?? 6 })),
  ...LOOKUP_IS_WITH_IN_SETS.map((testCase) => ({
    ...testCase,
    fieldIndex: testCase.fieldIndex ?? 6,
  })),
  ...LOOKUP_IS_BEFORE_SETS.map((testCase) => ({
    ...testCase,
    fieldIndex: testCase.fieldIndex ?? 6,
  })),
  ...LOOKUP_IS_AFTER_SETS.map((testCase) => ({
    ...testCase,
    fieldIndex: testCase.fieldIndex ?? 6,
  })),
  ...LOOKUP_IS_ON_OR_BEFORE_SETS.map((testCase) => ({
    ...testCase,
    fieldIndex: testCase.fieldIndex ?? 6,
  })),
  ...LOOKUP_IS_ON_OR_AFTER_SETS.map((testCase) => ({
    ...testCase,
    fieldIndex: testCase.fieldIndex ?? 6,
  })),
];
