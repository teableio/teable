import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  buildFormulaSnapshotContext,
  createFormulaTestContainer,
  createFormulaTestTable,
  type FormulaTestTable,
} from './testkit/FormulaSqlPgTestkit';

const describePgIntegration = process.env.TEABLE_V2_RUN_PG_INTEGRATION ? describe : describe.skip;

describePgIntegration('DATETIME_PARSE custom format (integration)', () => {
  let container: IV2NodeTestContainer;
  let testTable: FormulaTestTable;

  beforeAll(async () => {
    container = await createFormulaTestContainer();
    testTable = await createFormulaTestTable(
      container,
      [
        {
          name: 'MonthBucket',
          expression: 'DATETIME_PARSE({Date}, "MMYYYY")',
        },
      ],
      {
        formulaTimeZone: 'Asia/Shanghai',
      }
    );
  });

  afterAll(async () => {
    await container.dispose();
  });

  it('formats the datetime in formula timezone before reparsing MMYYYY', async () => {
    const context = await buildFormulaSnapshotContext(testTable, 'MonthBucket');

    expect(context.sql).toContain('TO_CHAR');
    expect(context.sql).toContain('TO_TIMESTAMP');
    expect(context.sql).toContain("AT TIME ZONE 'Asia/Shanghai'");
    expect(context.result).toBe('2024-01-31 16:00:00+00');
  });
});
