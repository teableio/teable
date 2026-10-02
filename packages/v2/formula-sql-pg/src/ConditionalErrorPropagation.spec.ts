import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createFormulaTestContainer,
  createFormulaTestTable,
  executeFormulaAsText,
  type FormulaTestTable,
} from './testkit/FormulaSqlPgTestkit';

const cases = [
  { name: 'LiveThen', expression: 'IS_ERROR(IF(TRUE, ERROR("then"), 7))', expected: 'true' },
  { name: 'LiveElse', expression: 'IS_ERROR(IF(FALSE, 7, ERROR("else")))', expected: 'true' },
  { name: 'DeadThen', expression: 'IS_ERROR(IF(FALSE, ERROR("then"), 7))', expected: 'false' },
  { name: 'DeadElse', expression: 'IS_ERROR(IF(TRUE, 7, ERROR("else")))', expected: 'false' },
  { name: 'NullValue', expression: 'IS_ERROR(BLANK())', expected: 'false' },
  { name: 'LiveCondition', expression: 'IS_ERROR(IF(ERROR("condition"), 1, 2))', expected: 'true' },
  {
    name: 'NestedLive',
    expression: 'IS_ERROR(IF(TRUE, IF(FALSE, 1, ERROR("nested")), 2))',
    expected: 'true',
  },
  {
    name: 'NestedDead',
    expression: 'IS_ERROR(IF(FALSE, IF(FALSE, 1, ERROR("nested")), 2))',
    expected: 'false',
  },
  {
    name: 'SelectedMessage',
    expression: 'IF(FALSE, ERROR("then"), ERROR("else"))',
    expected: '#ERROR:USER:else',
  },
];

describe('conditional error propagation', () => {
  let container: IV2NodeTestContainer;
  let table: FormulaTestTable;
  beforeAll(async () => {
    container = await createFormulaTestContainer();
    table = await createFormulaTestTable(container, cases, {
      profile: 'minimal',
      fieldTypes: ['number'],
    });
  });
  afterAll(async () => {
    await container?.dispose();
  });
  it.each(cases)('$name', async ({ name, expected }) => {
    await expect(executeFormulaAsText(table, name)).resolves.toBe(expected);
  });
});
