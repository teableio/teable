import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  buildFormulaSnapshotContext,
  createFormulaTestContainer,
  createFormulaTestTable,
  type FormulaFieldDefinition,
  type FormulaTestTable,
} from './testkit/FormulaSqlPgTestkit';

describe('DATE_ADD timezone handling', () => {
  let container: IV2NodeTestContainer;
  let testTable: FormulaTestTable;

  beforeAll(async () => {
    container = await createFormulaTestContainer();
    const formulaFields: FormulaFieldDefinition[] = [
      {
        name: 'DateAddNaive',
        expression: `DATE_ADD('2026-02-02 00:00:00', 1, 'days')`,
      },
      {
        name: 'DateAddWithZone',
        expression: `DATE_ADD('2026-02-02T00:00:00Z', 1, 'days')`,
      },
      {
        name: 'DateAddNaiveWeek',
        expression: `DATE_ADD('2026-02-02 00:00:00', 1, 'weeks')`,
      },
      {
        name: 'DateAddNaiveHour',
        expression: `DATE_ADD('2026-02-02 00:00:00', 1, 'hours')`,
      },
      {
        name: 'DateAddNaiveMonth',
        expression: `DATE_ADD('2026-02-02 00:00:00', 1, 'months')`,
      },
    ];
    testTable = await createFormulaTestTable(container, formulaFields, {
      formulaTimeZone: 'Asia/Shanghai',
    });
  });

  afterAll(async () => {
    await container.dispose();
  });

  it('interprets naive datetime text in formula timezone before adding days', async () => {
    const context = await buildFormulaSnapshotContext(testTable, 'DateAddNaive');
    expect(context.sql).toContain("AT TIME ZONE 'Asia/Shanghai'");
    expect(context.result).toBe('2026-02-02 16:00:00+00');
  });

  it('keeps explicit timezone datetime text as absolute instant', async () => {
    const context = await buildFormulaSnapshotContext(testTable, 'DateAddWithZone');
    expect(context.result).toBe('2026-02-03 00:00:00+00');
  });

  it('adds one week for naive datetime text in formula timezone', async () => {
    const context = await buildFormulaSnapshotContext(testTable, 'DateAddNaiveWeek');
    expect(context.result).toBe('2026-02-08 16:00:00+00');
  });

  it('adds one hour for naive datetime text in formula timezone', async () => {
    const context = await buildFormulaSnapshotContext(testTable, 'DateAddNaiveHour');
    expect(context.result).toBe('2026-02-01 17:00:00+00');
  });

  it('adds one month for naive datetime text in formula timezone', async () => {
    const context = await buildFormulaSnapshotContext(testTable, 'DateAddNaiveMonth');
    expect(context.result).toBe('2026-03-01 16:00:00+00');
  });
});
