import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  buildFormulaSnapshotContext,
  createFormulaTestContainer,
  createFormulaTestTable,
  type FormulaFieldDefinition,
  type FormulaTestTable,
} from './testkit/FormulaSqlPgTestkit';

describe('workday with dynamic day count field', () => {
  let container: IV2NodeTestContainer;
  let testTable: FormulaTestTable;

  beforeAll(async () => {
    container = await createFormulaTestContainer();
    const formulaFields: FormulaFieldDefinition[] = [
      {
        name: 'WorkdayDateWithNumber',
        expression: 'WORKDAY({Date}, {Number})',
      },
    ];
    testTable = await createFormulaTestTable(container, formulaFields);
  });

  afterAll(async () => {
    await container.dispose();
  });

  it('generates SQL that multiplies day interval by numeric field expression', async () => {
    const context = await buildFormulaSnapshotContext(testTable, 'WorkdayDateWithNumber');

    expect(context.formula).toBe('WORKDAY({Date}, {Number})');
    expect(context.sql).toContain("INTERVAL '1 day' *");
    expect(context.sql).toContain('"t"."Number"');
  });

  it('computes value from pglite with date + number field', async () => {
    const context = await buildFormulaSnapshotContext(testTable, 'WorkdayDateWithNumber');

    expect(context.result).toBe('2024-02-13 00:00:00');
  });
});
