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

describe('DATETIME_DIFF parity', () => {
  let container: IV2NodeTestContainer;
  let testTable: FormulaTestTable;

  beforeAll(async () => {
    container = await createFormulaTestContainer();
    testTable = await createFormulaTestTable(container, [
      {
        name: 'DiffDefaultUnit',
        expression: 'DATETIME_DIFF("2024-01-03T00:00:00Z", "2024-01-01T00:00:00Z")',
      },
      {
        name: 'DiffExplicitDay',
        expression: 'DATETIME_DIFF("2024-01-03T00:00:00Z", "2024-01-01T00:00:00Z", "day")',
      },
      {
        name: 'DiffSubSecondPositiveDay',
        expression: 'DATETIME_DIFF("2024-01-01T00:00:00.500Z", "2024-01-01T00:00:00.000Z", "day")',
      },
      {
        name: 'DiffSubSecondNegativeDay',
        expression: 'DATETIME_DIFF("2024-01-01T00:00:00.000Z", "2024-01-01T00:00:00.500Z", "day")',
      },
      {
        name: 'DiffMinuteShorthand',
        expression: 'DATETIME_DIFF("2024-01-01T01:30:00.000Z", "2024-01-01T00:00:00.000Z", "m")',
      },
    ]);
  });

  afterAll(async () => {
    await container.dispose();
  });

  it('defaults DATETIME_DIFF unit to day when omitted', async () => {
    const [defaultContext, explicitDayContext] = await Promise.all([
      buildFormulaSnapshotContext(testTable, 'DiffDefaultUnit'),
      buildFormulaSnapshotContext(testTable, 'DiffExplicitDay'),
    ]);

    expect(defaultContext.sql).toContain('/ 86400');

    const defaultValue = parseNumericResult(defaultContext.result);
    const explicitDayValue = parseNumericResult(explicitDayContext.result);

    expect(defaultValue).toBeCloseTo(2, 10);
    expect(defaultValue).toBeCloseTo(explicitDayValue, 10);
  });

  it('returns zero for day unit when datetime difference is sub-second', async () => {
    const [positiveContext, negativeContext] = await Promise.all([
      buildFormulaSnapshotContext(testTable, 'DiffSubSecondPositiveDay'),
      buildFormulaSnapshotContext(testTable, 'DiffSubSecondNegativeDay'),
    ]);

    expect(positiveContext.sql).toContain('ABS((');
    expect(positiveContext.sql).toContain('< 1 THEN 0::double precision');

    expect(parseNumericResult(positiveContext.result)).toBeCloseTo(0, 10);
    expect(parseNumericResult(negativeContext.result)).toBeCloseTo(0, 10);
  });

  it('supports minute shorthand unit "m"', async () => {
    const context = await buildFormulaSnapshotContext(testTable, 'DiffMinuteShorthand');

    expect(context.sql).toContain('/ 60');
    expect(parseNumericResult(context.result)).toBeCloseTo(90, 10);
  });
});
