import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  buildFormulaSnapshotContext,
  createFormulaTestContainer,
  createFormulaTestTable,
  type FormulaFieldDefinition,
  type FormulaTestTable,
} from './testkit/FormulaSqlPgTestkit';

type WorkdayCase = {
  id: string;
  expression: string;
  expected: string;
  sqlMustContain: ReadonlyArray<string>;
};

const workdayCases: ReadonlyArray<WorkdayCase> = [
  {
    id: 'WeekendSkip',
    expression: 'DATESTR(WORKDAY("2026-01-15", 3))',
    expected: '2026-01-20',
    sqlMustContain: ['generate_series'],
  },
  {
    id: 'HolidaySingle',
    expression: 'DATESTR(WORKDAY("2026-01-15", 3, "2026-01-16"))',
    expected: '2026-01-21',
    sqlMustContain: ['generate_series', 'regexp_split_to_table'],
  },
  {
    id: 'HolidayMultiple',
    expression: 'DATESTR(WORKDAY("2026-01-15", 3, "2026-01-16,2026-01-19"))',
    expected: '2026-01-22',
    sqlMustContain: ['generate_series', 'regexp_split_to_table'],
  },
  {
    id: 'PlusFiveWeekendSkip',
    expression: 'DATESTR(WORKDAY("2026-02-09", 5))',
    expected: '2026-02-16',
    sqlMustContain: ['generate_series'],
  },
  {
    id: 'NegativeOffset',
    expression: 'DATESTR(WORKDAY("2026-02-16", -1))',
    expected: '2026-02-13',
    sqlMustContain: ['generate_series'],
  },
];

describe('workday formula sql + result', () => {
  let container: IV2NodeTestContainer;
  let testTable: FormulaTestTable;

  beforeAll(async () => {
    container = await createFormulaTestContainer();
    const formulaFields: FormulaFieldDefinition[] = workdayCases.map(({ id, expression }) => ({
      name: id,
      expression,
    }));
    testTable = await createFormulaTestTable(container, formulaFields);
  });

  afterAll(async () => {
    await container.dispose();
  });

  it.each(workdayCases)('$id', async ({ id, expression, expected, sqlMustContain }) => {
    const context = await buildFormulaSnapshotContext(testTable, id);

    expect(context.formula).toBe(expression);
    sqlMustContain.forEach((sqlPart) => {
      expect(context.sql).toContain(sqlPart);
    });
    expect(context.result).toBe(expected);
  });
});
