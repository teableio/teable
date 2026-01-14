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

type LogicalFunctionCase = {
  id: string;
  buildExpression: (fieldName: string) => string;
};

const logicalFunctionCases: ReadonlyArray<LogicalFunctionCase> = [
  { id: 'If', buildExpression: (fieldName) => `IF({${fieldName}}, "yes", "no")` },
  { id: 'And', buildExpression: (fieldName) => `AND({${fieldName}}, TRUE)` },
  { id: 'Or', buildExpression: (fieldName) => `OR({${fieldName}}, FALSE)` },
  { id: 'Not', buildExpression: (fieldName) => `NOT({${fieldName}})` },
  { id: 'Xor', buildExpression: (fieldName) => `XOR({${fieldName}}, TRUE)` },
  { id: 'IsError', buildExpression: (fieldName) => `IS_ERROR({${fieldName}})` },
  {
    id: 'Switch',
    buildExpression: (fieldName) => `SWITCH({${fieldName}}, 10, "ten", "other")`,
  },
];

const buildFormulaName = (funcId: string, fieldName: string): string => `${funcId}_${fieldName}`;

describe('logical functions', () => {
  const fieldCases = createFieldTypeCases();
  const matrix = logicalFunctionCases.flatMap((fn) =>
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
      ...logicalFunctionCases.flatMap((fn) =>
        fieldCases.map((fieldCase) => ({
          name: buildFormulaName(fn.id, fieldCase.fieldName),
          expression: fn.buildExpression(fieldCase.fieldName),
        }))
      ),
      { name: 'BlankValue', expression: 'BLANK()' },
      { name: 'ErrorValue', expression: 'ERROR("boom")' },
      { name: 'CompareNumberText', expression: '{SingleLineText} = {Number}' },
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
    { id: 'Blank', formulaName: 'BlankValue' },
    { id: 'Error', formulaName: 'ErrorValue' },
    { id: 'Compare', formulaName: 'CompareNumberText' },
  ])('$id handles constant formula', async ({ id, formulaName }) => {
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
