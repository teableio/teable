/**
 * Validators for test assertions
 */

import { expect } from 'vitest';
import type { FormulaTestCase } from './types';

// Literal expectations for the four formula fixtures, followed by two +10 levels.
// Text outputs concatenate with +10; numeric null operands are treated as zero.
const FORMULA_VALUES: Record<
  FormulaTestCase['source'],
  Record<FormulaTestCase['transition'], readonly (number | string)[]>
> = {
  number: {
    nullToValue: [20, 30, 40],
    valueToValue: [40, 50, 60],
    valueToNull: [0, 10, 20],
  },
  rating: {
    nullToValue: [30, 40, 50],
    valueToValue: [50, 60, 70],
    valueToNull: [0, 10, 20],
  },
  singleLineText: {
    nullToValue: ['Result: hello', 'Result: hello10', 'Result: hello1010'],
    valueToValue: ['Result: world', 'Result: world10', 'Result: world1010'],
    valueToNull: ['Result: ', 'Result: 10', 'Result: 1010'],
  },
  checkbox: {
    nullToValue: ['Yes', 'Yes10', 'Yes1010'],
    valueToValue: ['No', 'No10', 'No1010'],
    valueToNull: ['No', 'No10', 'No1010'],
  },
};

export const getExpectedFormulaValues = (
  source: FormulaTestCase['source'],
  transition: FormulaTestCase['transition']
): readonly (number | string)[] => FORMULA_VALUES[source][transition];

export const verifyLookupValue = (value: unknown, expectedValues: unknown[] | null): void => {
  expect(value).toEqual(expectedValues);
};
