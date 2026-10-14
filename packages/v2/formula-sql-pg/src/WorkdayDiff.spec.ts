import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  buildFormulaSnapshotContext,
  createFormulaTestContainer,
  createFormulaTestTable,
  type FormulaFieldDefinition,
  type FormulaTestTable,
} from './testkit/FormulaSqlPgTestkit';

type WorkdayDiffCase = {
  id: string;
  expression: string;
  expected: string;
};

const workdayDiffCases: ReadonlyArray<WorkdayDiffCase> = [
  {
    id: 'WeekdayOnly',
    expression: 'WORKDAY_DIFF("2026-02-23", "2026-02-27")',
    expected: '5',
  },
  {
    id: 'CrossWeekend',
    expression: 'WORKDAY_DIFF("2026-02-23", "2026-03-02")',
    expected: '6',
  },
  {
    id: 'WeekendOnly',
    expression: 'WORKDAY_DIFF("2026-02-28", "2026-03-01")',
    expected: '0',
  },
  {
    id: 'HolidayExclusion',
    expression: 'WORKDAY_DIFF("2026-02-23", "2026-03-02", "2026-02-24")',
    expected: '5',
  },
  {
    id: 'ReverseRange',
    expression: 'WORKDAY_DIFF("2026-03-02", "2026-02-23")',
    expected: '-6',
  },
  {
    id: 'IncludesWorkdayStart',
    expression: 'WORKDAY_DIFF("2026-02-23", WORKDAY("2026-02-23", 5))',
    expected: '6',
  },
];

describe('workday diff formula sql + result', () => {
  let container: IV2NodeTestContainer;
  let testTable: FormulaTestTable;

  beforeAll(async () => {
    container = await createFormulaTestContainer();
    const formulaFields: FormulaFieldDefinition[] = workdayDiffCases.map(({ id, expression }) => ({
      name: id,
      expression,
    }));
    testTable = await createFormulaTestTable(container, formulaFields);
  });

  afterAll(async () => {
    await container.dispose();
  });

  it.each(workdayDiffCases)('$id', async ({ id, expected }) => {
    const context = await buildFormulaSnapshotContext(testTable, id);

    expect(context.result).toBe(expected);
  });
});
