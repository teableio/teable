import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  buildFormulaSnapshotContext,
  createFormulaTestContainer,
  createFormulaTestTable,
  type FormulaTestTable,
} from './testkit/FormulaSqlPgTestkit';

const DATETIME_FORMAT_SPECIFIER_CASES = [
  { token: 'YY', expected: '26' },
  { token: 'YYYY', expected: '2026' },
  { token: 'M', expected: '2' },
  { token: 'MM', expected: '02' },
  { token: 'MMM', expected: 'Feb' },
  { token: 'MMMM', expected: 'February' },
  { token: 'D', expected: '12' },
  { token: 'DD', expected: '12' },
  { token: 'd', expected: '4' },
  { token: 'dd', expected: 'Th' },
  { token: 'ddd', expected: 'Thu' },
  { token: 'dddd', expected: 'Thursday' },
  { token: 'H', expected: '15' },
  { token: 'HH', expected: '15' },
  { token: 'h', expected: '3' },
  { token: 'hh', expected: '03' },
  { token: 'm', expected: '4' },
  { token: 'mm', expected: '04' },
  { token: 's', expected: '5' },
  { token: 'ss', expected: '05' },
  { token: 'SSS', expected: '678' },
  { token: 'Z', expected: '+00:00' },
  { token: 'ZZ', expected: '+0000' },
  { token: 'A', expected: 'PM' },
  { token: 'a', expected: 'pm' },
  { token: 'LT', expected: '3:04 PM' },
  { token: 'LTS', expected: '3:04:05 PM' },
  { token: 'L', expected: '02/12/2026' },
  { token: 'LL', expected: 'February 12, 2026' },
  { token: 'LLL', expected: 'February 12, 2026 3:04 PM' },
  { token: 'LLLL', expected: 'Thursday, February 12, 2026 3:04 PM' },
  { token: 'l', expected: '2/12/2026' },
  { token: 'll', expected: 'Feb 12, 2026' },
  { token: 'lll', expected: 'Feb 12, 2026 3:04 PM' },
  { token: 'llll', expected: 'Thu, Feb 12, 2026 3:04 PM' },
] as const;

const DATETIME_FORMAT_SPECIFIER_FIELDS = DATETIME_FORMAT_SPECIFIER_CASES.map((item, index) => ({
  ...item,
  formulaName: `DatetimeFormatSpecifier_${index.toString().padStart(2, '0')}`,
}));

describe('DATETIME_FORMAT specifiers', () => {
  let container: IV2NodeTestContainer;
  let testTable: FormulaTestTable;

  beforeAll(async () => {
    container = await createFormulaTestContainer();
    testTable = await createFormulaTestTable(
      container,
      DATETIME_FORMAT_SPECIFIER_FIELDS.map((item) => ({
        name: item.formulaName,
        expression: `DATETIME_FORMAT("2026-02-12T15:04:05.678Z", "${item.token}")`,
      }))
    );
  });

  afterAll(async () => {
    await container.dispose();
  });

  it.each(DATETIME_FORMAT_SPECIFIER_FIELDS)(
    'formats token $token',
    async ({ token, expected, formulaName }) => {
      const context = await buildFormulaSnapshotContext(testTable, formulaName);

      expect(context.result).toBe(expected);
      expect({ token, expected, result: context.result, sql: context.sql }).toMatchSnapshot();
    }
  );
});
