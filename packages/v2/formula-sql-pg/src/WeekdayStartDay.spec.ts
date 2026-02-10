import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  buildFormulaSnapshotContext,
  createFormulaTestContainer,
  createFormulaTestTable,
  type FormulaTestTable,
} from './testkit/FormulaSqlPgTestkit';

const parseNumericResult = (value: string | null): number => {
  expect(value).not.toBeNull();
  const parsed = Number(value);
  expect(Number.isFinite(parsed)).toBe(true);
  return parsed;
};

describe('WEEKDAY startDayOfWeek', () => {
  let container: IV2NodeTestContainer;
  let testTable: FormulaTestTable;

  beforeAll(async () => {
    container = await createFormulaTestContainer();
    testTable = await createFormulaTestTable(container, [
      { name: 'WeekdayDefault', expression: 'WEEKDAY({Date})' },
      { name: 'WeekdayMonday', expression: 'WEEKDAY({Date}, "Monday")' },
      { name: 'WeekdaySunday', expression: 'WEEKDAY({Date}, "Sunday")' },
    ]);
  });

  afterAll(async () => {
    await container.dispose();
  });

  it('shifts weekday index when start day is Monday', async () => {
    const [defaultContext, mondayContext, sundayContext] = await Promise.all([
      buildFormulaSnapshotContext(testTable, 'WeekdayDefault'),
      buildFormulaSnapshotContext(testTable, 'WeekdayMonday'),
      buildFormulaSnapshotContext(testTable, 'WeekdaySunday'),
    ]);

    const defaultValue = parseNumericResult(defaultContext.result);
    const mondayValue = parseNumericResult(mondayContext.result);
    const sundayValue = parseNumericResult(sundayContext.result);

    expect(sundayValue).toBe(defaultValue);
    expect(mondayValue).toBe((defaultValue + 6) % 7);

    expect(mondayContext.sql).toContain('% 7');
    expect(sundayContext.sql).not.toContain('% 7');
  });
});
