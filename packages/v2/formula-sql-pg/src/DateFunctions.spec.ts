import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  buildFormulaSnapshotContext,
  createFieldTypeCases,
  createFormulaTestContainer,
  createFormulaTestTable,
  type FormulaFieldDefinition,
  type FormulaTestTable,
} from './testkit/FormulaSqlPgTestkit';

type DateFunctionCase = {
  id: string;
  buildExpression: (fieldName: string) => string;
  normalizeResult?: (value: string | null) => string | null;
};

const maskDigits = (value: string | null): string | null =>
  value ? value.replace(/\d/g, '0') : value;

const dateFunctionCases: ReadonlyArray<DateFunctionCase> = [
  { id: 'Year', buildExpression: (fieldName) => `YEAR({${fieldName}})` },
  { id: 'Month', buildExpression: (fieldName) => `MONTH({${fieldName}})` },
  { id: 'WeekNum', buildExpression: (fieldName) => `WEEKNUM({${fieldName}})` },
  { id: 'Weekday', buildExpression: (fieldName) => `WEEKDAY({${fieldName}})` },
  { id: 'Day', buildExpression: (fieldName) => `DAY({${fieldName}})` },
  { id: 'Hour', buildExpression: (fieldName) => `HOUR({${fieldName}})` },
  { id: 'Minute', buildExpression: (fieldName) => `MINUTE({${fieldName}})` },
  { id: 'Second', buildExpression: (fieldName) => `SECOND({${fieldName}})` },
  {
    id: 'FromNow',
    buildExpression: (fieldName) => `FROMNOW({${fieldName}}, "day")`,
    normalizeResult: maskDigits,
  },
  {
    id: 'ToNow',
    buildExpression: (fieldName) => `TONOW({${fieldName}}, "day")`,
    normalizeResult: maskDigits,
  },
  {
    id: 'DatetimeDiff',
    buildExpression: (fieldName) =>
      `DATETIME_DIFF({${fieldName}}, DATE_ADD({${fieldName}}, 1, "day"), "day")`,
  },
  {
    id: 'DatetimeDiffUnitField',
    buildExpression: (fieldName) =>
      `DATETIME_DIFF("2024-01-02T00:00:00Z", "2024-01-03T00:00:00Z", {${fieldName}})`,
  },
  {
    id: 'DatetimeDiffInvalidUnit',
    buildExpression: (fieldName) =>
      `DATETIME_DIFF({${fieldName}}, DATE_ADD({${fieldName}}, 1, "day"), "banana")`,
  },
  { id: 'Workday', buildExpression: (fieldName) => `WORKDAY({${fieldName}}, 2)` },
  {
    id: 'WorkdayDiff',
    buildExpression: (fieldName) =>
      `WORKDAY_DIFF({${fieldName}}, DATE_ADD({${fieldName}}, 2, "day"))`,
  },
  {
    id: 'IsSame',
    buildExpression: (fieldName) =>
      `IS_SAME({${fieldName}}, DATE_ADD({${fieldName}}, 1, "day"), "day")`,
  },
  {
    id: 'IsSameUnitField',
    buildExpression: (fieldName) =>
      `IS_SAME("2024-01-02T00:00:00Z", "2024-01-03T00:00:00Z", {${fieldName}})`,
  },
  {
    id: 'IsSameInvalidUnit',
    buildExpression: (fieldName) =>
      `IS_SAME({${fieldName}}, DATE_ADD({${fieldName}}, 1, "day"), "banana")`,
  },
  {
    id: 'IsAfter',
    buildExpression: (fieldName) => `IS_AFTER(DATE_ADD({${fieldName}}, 1, "day"), {${fieldName}})`,
  },
  {
    id: 'IsBefore',
    buildExpression: (fieldName) => `IS_BEFORE({${fieldName}}, DATE_ADD({${fieldName}}, 1, "day"))`,
  },
  { id: 'DateAdd', buildExpression: (fieldName) => `DATE_ADD({${fieldName}}, 1, "day")` },
  {
    id: 'DateAddCountField',
    buildExpression: (fieldName) => `DATE_ADD("2024-01-02T00:00:00Z", {${fieldName}}, "day")`,
  },
  {
    id: 'DateAddUnitField',
    buildExpression: (fieldName) => `DATE_ADD("2024-01-02T00:00:00Z", 1, {${fieldName}})`,
  },
  {
    id: 'DateAddInvalidUnit',
    buildExpression: (fieldName) => `DATE_ADD({${fieldName}}, 1, "banana")`,
  },
  { id: 'Datestr', buildExpression: (fieldName) => `DATESTR({${fieldName}})` },
  { id: 'Timestr', buildExpression: (fieldName) => `TIMESTR({${fieldName}})` },
  {
    id: 'DatetimeFormat',
    buildExpression: (fieldName) => `DATETIME_FORMAT({${fieldName}}, "YYYY-MM-DD HH:mm")`,
  },
  { id: 'DatetimeParse', buildExpression: (fieldName) => `DATETIME_PARSE({${fieldName}})` },
];

const buildFormulaName = (funcId: string, fieldName: string): string => `${funcId}_${fieldName}`;

const chunkArray = <T>(items: ReadonlyArray<T>, size: number): ReadonlyArray<ReadonlyArray<T>> => {
  const chunks: Array<ReadonlyArray<T>> = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const fieldCases = createFieldTypeCases();
const dateFunctionChunks = chunkArray(dateFunctionCases, 7);

describe('DATETIME_PARSE without custom format uses formula time zone', () => {
  let container: IV2NodeTestContainer | undefined;
  let testTable: FormulaTestTable;

  beforeAll(async () => {
    container = await createFormulaTestContainer();
    const formulaFields: FormulaFieldDefinition[] = [
      {
        name: 'DatetimeParseWithoutFormat',
        expression: 'DATETIME_PARSE("2026-01-15 08:30:00")',
      },
    ];
    testTable = await createFormulaTestTable(container, formulaFields, {
      formulaTimeZone: 'Asia/Shanghai',
    });
  });

  afterAll(async () => {
    await container?.dispose();
  });

  it('renders SQL with Asia/Shanghai and keeps correct conversion', async () => {
    const context = await buildFormulaSnapshotContext(testTable, 'DatetimeParseWithoutFormat');
    expect(context.sql).toContain("AT TIME ZONE 'Asia/Shanghai'");
    expect(context.result).toBe('2026-01-15 00:30:00+00');
    expect({
      formula: context.formula,
      hasFormulaTimeZone: context.sql.includes('Asia/Shanghai'),
      result: context.result,
    }).toMatchInlineSnapshot(`
{
  "formula": "DATETIME_PARSE("2026-01-15 08:30:00")",
  "hasFormulaTimeZone": true,
  "result": "2026-01-15 00:30:00+00",
}
`);
  });
});

const runDateFunctionSuite = (label: string, cases: ReadonlyArray<DateFunctionCase>) => {
  describe(label, () => {
    const matrix = cases.flatMap((fn) =>
      fieldCases.map((fieldCase) => ({
        funcId: fn.id,
        fieldCase,
        formulaName: buildFormulaName(fn.id, fieldCase.fieldName),
        normalizeResult: fn.normalizeResult,
      }))
    );
    let container: IV2NodeTestContainer | undefined;
    let testTable: FormulaTestTable;

    beforeAll(async () => {
      container = await createFormulaTestContainer();
      const formulaFields: FormulaFieldDefinition[] = cases.flatMap((fn) =>
        fieldCases.map((fieldCase) => ({
          name: buildFormulaName(fn.id, fieldCase.fieldName),
          expression: fn.buildExpression(fieldCase.fieldName),
        }))
      );
      testTable = await createFormulaTestTable(container, formulaFields);
    });

    afterAll(async () => {
      await container?.dispose();
    });

    it.each(matrix)(
      '$funcId with $fieldCase.type',
      async ({ funcId, fieldCase, formulaName, normalizeResult }) => {
        const context = await buildFormulaSnapshotContext(testTable, formulaName);
        const result = normalizeResult ? normalizeResult(context.result) : context.result;
        expect({
          funcId,
          fieldType: fieldCase.type,
          formula: context.formula,
          sql: context.sql,
          inputs: context.inputs,
          result,
        }).toMatchSnapshot();
      }
    );
  });
};

dateFunctionChunks.forEach((cases, index) => {
  runDateFunctionSuite(`date functions batch ${index + 1}`, cases);
});
