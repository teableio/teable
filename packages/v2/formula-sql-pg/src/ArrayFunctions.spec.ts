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

type ArrayFunctionCase = {
  id: string;
  buildExpression: (fieldName: string) => string;
};

const arrayFunctionCases: ReadonlyArray<ArrayFunctionCase> = [
  { id: 'ArrayJoin', buildExpression: (fieldName) => `ARRAYJOIN({${fieldName}}, "|")` },
  {
    id: 'ArrayUnique',
    buildExpression: (fieldName) => `ARRAYUNIQUE({${fieldName}}, {${fieldName}})`,
  },
  {
    id: 'ArrayFlatten',
    buildExpression: (fieldName) => `ARRAYFLATTEN({${fieldName}}, {${fieldName}})`,
  },
  {
    id: 'ArrayCompact',
    buildExpression: (fieldName) => `ARRAYCOMPACT({${fieldName}}, {${fieldName}})`,
  },
  { id: 'Count', buildExpression: (fieldName) => `COUNT({${fieldName}})` },
  { id: 'CountA', buildExpression: (fieldName) => `COUNTA({${fieldName}})` },
  { id: 'CountAll', buildExpression: (fieldName) => `COUNTALL({${fieldName}})` },
];

const buildFormulaName = (funcId: string, fieldName: string): string => `${funcId}_${fieldName}`;

describe('array functions', () => {
  const fieldCases = createFieldTypeCases();
  const matrix = arrayFunctionCases.flatMap((fn) =>
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
      ...arrayFunctionCases.flatMap((fn) =>
        fieldCases.map((fieldCase) => ({
          name: buildFormulaName(fn.id, fieldCase.fieldName),
          expression: fn.buildExpression(fieldCase.fieldName),
        }))
      ),
      // Optional parameter tests
      { name: 'ArrayJoinNoSeparator', expression: 'ARRAYJOIN({MultipleSelect})' },
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

  it('ArrayJoinNoSeparator uses default separator', async () => {
    const context = await buildFormulaSnapshotContext(testTable, 'ArrayJoinNoSeparator');
    expect({
      funcId: 'ArrayJoinNoSeparator',
      formula: context.formula,
      sql: context.sql,
      inputs: context.inputs,
      result: context.result,
    }).toMatchSnapshot();
  });
});
