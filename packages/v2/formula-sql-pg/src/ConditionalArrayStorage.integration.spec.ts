import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createFormulaTestContainer,
  createFormulaTestTable,
  executeFormulaAsText,
  type FormulaTestTable,
} from './testkit/FormulaSqlPgTestkit';

const cases = [
  {
    name: 'IfThenArray',
    expression: 'SUM(ARRAY_COMPACT(IF(TRUE, TEXTSPLIT("12:34", ":"), TEXTSPLIT("5:6", ":"))))',
    expected: '46',
  },
  {
    name: 'IfElseArray',
    expression: 'SUM(ARRAY_COMPACT(IF(FALSE, TEXTSPLIT("12:34", ":"), TEXTSPLIT("5:6", ":"))))',
    expected: '11',
  },
  {
    name: 'SwitchDefaultArray',
    expression:
      'SUM(ARRAY_COMPACT(SWITCH("b", "a", TEXTSPLIT("12:34", ":"), TEXTSPLIT("5:6", ":"))))',
    expected: '11',
  },
  {
    name: 'NestedConditionalArray',
    expression:
      'SUM(ARRAY_COMPACT(IF(TRUE, SWITCH("a", "a", TEXTSPLIT("12:34", ":")), TEXTSPLIT("5:6", ":"))))',
    expected: '46',
  },
];

describe('conditional arrays preserve executed formula values', () => {
  let container: IV2NodeTestContainer;
  let table: FormulaTestTable;

  beforeAll(async () => {
    container = await createFormulaTestContainer();
    table = await createFormulaTestTable(container, cases);
  });

  afterAll(async () => {
    await container?.dispose();
  });

  it.each(cases)('$name', async ({ name, expected }) => {
    await expect(executeFormulaAsText(table, name)).resolves.toBe(expected);
  });
});
