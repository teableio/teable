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
  sqlMustContain: ReadonlyArray<string>;
};

const workdayDiffCases: ReadonlyArray<WorkdayDiffCase> = [
  {
    id: 'WeekdayOnly',
    expression: 'WORKDAY_DIFF("2026-02-23", "2026-02-27")',
    expected: '4',
    sqlMustContain: ['generate_series', 'EXTRACT(DOW'],
  },
  {
    id: 'CrossWeekend',
    expression: 'WORKDAY_DIFF("2026-02-23", "2026-03-02")',
    expected: '5',
    sqlMustContain: ['generate_series', 'EXTRACT(DOW'],
  },
  {
    id: 'WeekendOnly',
    expression: 'WORKDAY_DIFF("2026-02-28", "2026-03-01")',
    expected: '0',
    sqlMustContain: ['generate_series', 'EXTRACT(DOW'],
  },
  {
    id: 'HolidayExclusion',
    expression: 'WORKDAY_DIFF("2026-02-23", "2026-03-02", "2026-02-24")',
    expected: '4',
    sqlMustContain: ['generate_series', 'regexp_split_to_table'],
  },
  {
    id: 'ReverseRange',
    expression: 'WORKDAY_DIFF("2026-03-02", "2026-02-23")',
    expected: '-5',
    sqlMustContain: ['generate_series', 'CASE WHEN p.end_date >= p.start_date'],
  },
  {
    id: 'InverseOfWorkday',
    expression: 'WORKDAY_DIFF("2026-02-23", WORKDAY("2026-02-23", 5))',
    expected: '5',
    sqlMustContain: ['generate_series', 'OFFSET ABS(p.day_count) - 1'],
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

  it.each(workdayDiffCases)('$id', async ({ id, expression, expected, sqlMustContain }) => {
    const context = await buildFormulaSnapshotContext(testTable, id);

    expect(context.formula).toBe(expression);
    sqlMustContain.forEach((sqlPart) => {
      expect(context.sql).toContain(sqlPart);
    });
    expect(context.result).toBe(expected);
  });
});
