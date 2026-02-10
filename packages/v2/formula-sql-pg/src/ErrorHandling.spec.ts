import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  buildFormulaSnapshotContext,
  createFormulaTestContainer,
  createFormulaTestTable,
  type FormulaFieldDefinition,
  type FormulaTestTable,
} from './testkit/FormulaSqlPgTestkit';

type ErrorTestCase = {
  id: string;
  expression: string;
  description: string;
};

const errorTestCases: ReadonlyArray<ErrorTestCase> = [
  // Type conversion errors
  {
    id: 'SumTypeError',
    expression: 'SUM({Button})',
    description: 'Sum with non-convertible type',
  },
  {
    id: 'AverageTypeError',
    expression: 'AVERAGE({Button})',
    description: 'Average with non-convertible type',
  },
  {
    id: 'MaxTypeError',
    expression: 'MAX({Button})',
    description: 'Max with non-convertible type',
  },
  {
    id: 'MinTypeError',
    expression: 'MIN({Button})',
    description: 'Min with non-convertible type',
  },
  {
    id: 'RoundTypeError',
    expression: 'ROUND({Button})',
    description: 'Round with non-convertible type',
  },
  {
    id: 'AbsTypeError',
    expression: 'ABS({Button})',
    description: 'Abs with non-convertible type',
  },
  {
    id: 'SqrtTypeError',
    expression: 'SQRT({Button})',
    description: 'Sqrt with non-convertible type',
  },
  {
    id: 'PowerTypeError',
    expression: 'POWER({Button}, 2)',
    description: 'Power with non-convertible type',
  },
  {
    id: 'LogTypeError',
    expression: 'LOG({Button})',
    description: 'Log with non-convertible type',
  },
  {
    id: 'ModTypeError',
    expression: 'MOD({Button}, 2)',
    description: 'Mod with non-convertible type',
  },
  {
    id: 'ValueTypeError',
    expression: 'VALUE({Button})',
    description: 'Value with non-convertible type',
  },
  {
    id: 'FindTypeError',
    expression: 'FIND("x", {Button})',
    description: 'Find with non-convertible type',
  },
  {
    id: 'SearchTypeError',
    expression: 'SEARCH("x", {Button})',
    description: 'Search with non-convertible type',
  },
  {
    id: 'MidTypeError',
    expression: 'MID({Button}, 1, 2)',
    description: 'Mid with non-convertible type',
  },
  {
    id: 'LeftTypeError',
    expression: 'LEFT({Button}, 1)',
    description: 'Left with non-convertible type',
  },
  {
    id: 'RightTypeError',
    expression: 'RIGHT({Button}, 1)',
    description: 'Right with non-convertible type',
  },
  {
    id: 'ReplaceTypeError',
    expression: 'REPLACE({Button}, 1, 1, "x")',
    description: 'Replace with non-convertible type',
  },
  {
    id: 'LenTypeError',
    expression: 'LEN({Button})',
    description: 'Len with non-convertible type',
  },
  {
    id: 'YearTypeError',
    expression: 'YEAR({Button})',
    description: 'Year with non-convertible type',
  },
  {
    id: 'MonthTypeError',
    expression: 'MONTH({Button})',
    description: 'Month with non-convertible type',
  },
  {
    id: 'DayTypeError',
    expression: 'DAY({Button})',
    description: 'Day with non-convertible type',
  },
  {
    id: 'DatetimeDiffTypeError',
    expression: 'DATETIME_DIFF({Button}, NOW(), "day")',
    description: 'DatetimeDiff with non-convertible type',
  },
  {
    id: 'DateAddTypeError',
    expression: 'DATE_ADD({Button}, 1, "day")',
    description: 'DateAdd with non-convertible type',
  },
  {
    id: 'AndTypeError',
    expression: 'AND({Button}, TRUE)',
    description: 'And with non-convertible type',
  },
  {
    id: 'OrTypeError',
    expression: 'OR({Button}, FALSE)',
    description: 'Or with non-convertible type',
  },
  {
    id: 'NotTypeError',
    expression: 'NOT({Button})',
    description: 'Not with non-convertible type',
  },
  {
    id: 'IfTypeError',
    expression: 'IF({Button}, "yes", "no")',
    description: 'If with non-convertible type',
  },
  // Division by zero
  {
    id: 'ModDivZero',
    expression: 'MOD(10, 0)',
    description: 'Mod with division by zero',
  },
  // Note: Missing parameter tests removed as they fail at formula parsing stage
  // These would need to be tested at a different level (formula parser tests)
];

describe('error handling', () => {
  let container: IV2NodeTestContainer;
  let testTable: FormulaTestTable;

  beforeAll(async () => {
    container = await createFormulaTestContainer();
    const formulaFields: FormulaFieldDefinition[] = errorTestCases.map((testCase) => ({
      name: testCase.id,
      expression: testCase.expression,
    }));
    testTable = await createFormulaTestTable(container, formulaFields);
  });

  afterAll(async () => {
    await container.dispose();
  });

  it.each(errorTestCases)('$id: $description', async ({ id, description }) => {
    const context = await buildFormulaSnapshotContext(testTable, id);
    expect({
      funcId: id,
      description,
      formula: context.formula,
      sql: context.sql,
      inputs: context.inputs,
      result: context.result,
    }).toMatchSnapshot();
  });
});
