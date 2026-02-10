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

describe('FROMNOW / TONOW', () => {
  let container: IV2NodeTestContainer;
  let testTable: FormulaTestTable;

  beforeAll(async () => {
    container = await createFormulaTestContainer();
    testTable = await createFormulaTestTable(container, [
      { name: 'FromNowDay', expression: 'FROMNOW({Date}, "day")' },
      { name: 'FromNowHour', expression: 'FROMNOW({Date}, "hour")' },
      { name: 'FromNowSecond', expression: 'FROMNOW({Date}, "second")' },
      { name: 'ToNowDay', expression: 'TONOW({Date}, "day")' },
      { name: 'FromNowLiteralPast', expression: 'FROMNOW("2000-01-01T00:00:00Z", "day")' },
      { name: 'ToNowLiteralPast', expression: 'TONOW("2000-01-01T00:00:00Z", "day")' },
    ]);
  });

  afterAll(async () => {
    await container.dispose();
  });

  it('applies unit conversion for day/hour/second', async () => {
    const [dayContext, hourContext, secondContext] = await Promise.all([
      buildFormulaSnapshotContext(testTable, 'FromNowDay'),
      buildFormulaSnapshotContext(testTable, 'FromNowHour'),
      buildFormulaSnapshotContext(testTable, 'FromNowSecond'),
    ]);

    expect(dayContext.sql).toContain('/ 86400');
    expect(hourContext.sql).toContain('/ 3600');
    expect(secondContext.sql).toContain('TRUNC((EXTRACT(EPOCH FROM (NOW() -');

    const dayValue = parseNumericResult(dayContext.result);
    const hourValue = parseNumericResult(hourContext.result);
    const secondValue = parseNumericResult(secondContext.result);

    expect(Math.abs(dayValue * 24 - hourValue)).toBeLessThanOrEqual(1);
    expect(Math.abs(hourValue * 3600 - secondValue)).toBeLessThanOrEqual(3600);
  });

  it('returns positive TONOW for past dates', async () => {
    const [fromNowContext, toNowContext] = await Promise.all([
      buildFormulaSnapshotContext(testTable, 'FromNowLiteralPast'),
      buildFormulaSnapshotContext(testTable, 'ToNowLiteralPast'),
    ]);

    expect(toNowContext.sql).toContain('NOW() -');
    expect(toNowContext.sql).not.toContain(' - NOW()');

    const fromNowValue = parseNumericResult(fromNowContext.result);
    const toNowValue = parseNumericResult(toNowContext.result);

    expect(fromNowValue).toBeGreaterThan(0);
    expect(toNowValue).toBeGreaterThan(0);
    expect(Math.abs(fromNowValue - toNowValue)).toBeLessThanOrEqual(1);
  });
});
