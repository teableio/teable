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

type NumericFunctionCase = {
  id: string;
  buildExpression: (fieldName: string) => string;
};

const numericFunctionCases: ReadonlyArray<NumericFunctionCase> = [
  { id: 'Sum', buildExpression: (fieldName) => `SUM({${fieldName}}, 2)` },
  { id: 'Average', buildExpression: (fieldName) => `AVERAGE({${fieldName}}, 2)` },
  { id: 'Max', buildExpression: (fieldName) => `MAX({${fieldName}}, 2)` },
  { id: 'Min', buildExpression: (fieldName) => `MIN({${fieldName}}, 2)` },
  { id: 'Round', buildExpression: (fieldName) => `ROUND({${fieldName}}, 1)` },
  { id: 'RoundUp', buildExpression: (fieldName) => `ROUNDUP({${fieldName}}, 1)` },
  { id: 'RoundDown', buildExpression: (fieldName) => `ROUNDDOWN({${fieldName}}, 1)` },
  { id: 'Ceiling', buildExpression: (fieldName) => `CEILING({${fieldName}})` },
  { id: 'Floor', buildExpression: (fieldName) => `FLOOR({${fieldName}})` },
  { id: 'Even', buildExpression: (fieldName) => `EVEN({${fieldName}})` },
  { id: 'Odd', buildExpression: (fieldName) => `ODD({${fieldName}})` },
  { id: 'Int', buildExpression: (fieldName) => `INT({${fieldName}})` },
  { id: 'Abs', buildExpression: (fieldName) => `ABS({${fieldName}})` },
  { id: 'Sqrt', buildExpression: (fieldName) => `SQRT({${fieldName}})` },
  { id: 'Power', buildExpression: (fieldName) => `POWER({${fieldName}}, 2)` },
  { id: 'Exp', buildExpression: (fieldName) => `EXP({${fieldName}})` },
  { id: 'Log', buildExpression: (fieldName) => `LOG({${fieldName}}, 10)` },
  { id: 'Mod', buildExpression: (fieldName) => `MOD({${fieldName}}, 2)` },
  { id: 'Value', buildExpression: (fieldName) => `VALUE({${fieldName}})` },
];

const buildFormulaName = (funcId: string, fieldName: string): string => `${funcId}_${fieldName}`;

describe('numeric functions', () => {
  const fieldCases = createFieldTypeCases();
  const matrix = numericFunctionCases.flatMap((fn) =>
    fieldCases.map((fieldCase) => ({
      funcId: fn.id,
      fieldCase,
      formulaName: buildFormulaName(fn.id, fieldCase.fieldName),
    }))
  );
  let container: IV2NodeTestContainer;
  let testTable: FormulaTestTable;

  beforeAll(async () => {
    container = await createFormulaTestContainer();
    const formulaFields: FormulaFieldDefinition[] = [
      ...numericFunctionCases.flatMap((fn) =>
        fieldCases.map((fieldCase) => ({
          name: buildFormulaName(fn.id, fieldCase.fieldName),
          expression: fn.buildExpression(fieldCase.fieldName),
        }))
      ),
      { name: 'ValueComma', expression: 'VALUE("1,000")' },
      { name: 'ValueBad', expression: 'VALUE("not-a-number")' },
      { name: 'DivZero', expression: '1/0' },
      // Optional parameter tests
      { name: 'RoundNoPrecision', expression: 'ROUND({Number})' },
      { name: 'RoundUpNoPrecision', expression: 'ROUNDUP({Number})' },
      { name: 'RoundDownNoPrecision', expression: 'ROUNDDOWN({Number})' },
      { name: 'LogNoBase', expression: 'LOG({Number})' },
      // Array input tests
      { name: 'SumWithArray', expression: 'SUM({MultipleSelect})' },
      { name: 'AverageWithArray', expression: 'AVERAGE({MultipleSelect})' },
      { name: 'MaxWithArray', expression: 'MAX({MultipleSelect})' },
      { name: 'MinWithArray', expression: 'MIN({MultipleSelect})' },
      { name: 'SumArrayAndScalar', expression: 'SUM({MultipleSelect}, 5)' },
    ];
    testTable = await createFormulaTestTable(container, formulaFields);
  });

  afterAll(async () => {
    await container.dispose();
  });

  it.each(matrix)('$funcId with $fieldCase.type', async ({ funcId, fieldCase, formulaName }) => {
    const context = await buildFormulaSnapshotContext(testTable, formulaName);
    expect({
      funcId,
      fieldType: fieldCase.type,
      formula: context.formula,
      sql: context.sql,
      inputs: context.inputs,
      result: context.result,
    }).toMatchSnapshot();
  });

  it.each([
    { id: 'ValueComma', formulaName: 'ValueComma' },
    { id: 'ValueBad', formulaName: 'ValueBad' },
    { id: 'DivZero', formulaName: 'DivZero' },
    { id: 'RoundNoPrecision', formulaName: 'RoundNoPrecision' },
    { id: 'RoundUpNoPrecision', formulaName: 'RoundUpNoPrecision' },
    { id: 'RoundDownNoPrecision', formulaName: 'RoundDownNoPrecision' },
    { id: 'LogNoBase', formulaName: 'LogNoBase' },
    { id: 'SumWithArray', formulaName: 'SumWithArray' },
    { id: 'AverageWithArray', formulaName: 'AverageWithArray' },
    { id: 'MaxWithArray', formulaName: 'MaxWithArray' },
    { id: 'MinWithArray', formulaName: 'MinWithArray' },
    { id: 'SumArrayAndScalar', formulaName: 'SumArrayAndScalar' },
  ])('$id uses constant input', async ({ id, formulaName }) => {
    const context = await buildFormulaSnapshotContext(testTable, formulaName);
    expect({
      funcId: id,
      formula: context.formula,
      sql: context.sql,
      inputs: context.inputs,
      result: context.result,
    }).toMatchSnapshot();
  });
});
