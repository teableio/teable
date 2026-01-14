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

type TextFunctionCase = {
  id: string;
  buildExpression: (fieldName: string) => string;
};

const textFunctionCases: ReadonlyArray<TextFunctionCase> = [
  { id: 'Concatenate', buildExpression: (fieldName) => `CONCATENATE({${fieldName}}, "-x")` },
  { id: 'Find', buildExpression: (fieldName) => `FIND("1", {${fieldName}}, 1)` },
  { id: 'Search', buildExpression: (fieldName) => `SEARCH("1", {${fieldName}}, 1)` },
  { id: 'Mid', buildExpression: (fieldName) => `MID({${fieldName}}, 1, 2)` },
  { id: 'Left', buildExpression: (fieldName) => `LEFT({${fieldName}}, 1)` },
  { id: 'Right', buildExpression: (fieldName) => `RIGHT({${fieldName}}, 1)` },
  { id: 'Replace', buildExpression: (fieldName) => `REPLACE({${fieldName}}, 1, 1, "x")` },
  {
    id: 'RegExpReplace',
    buildExpression: (fieldName) => `REGEXP_REPLACE({${fieldName}}, "1", "x")`,
  },
  { id: 'Substitute', buildExpression: (fieldName) => `SUBSTITUTE({${fieldName}}, "1", "x")` },
  { id: 'Lower', buildExpression: (fieldName) => `LOWER({${fieldName}})` },
  { id: 'Upper', buildExpression: (fieldName) => `UPPER({${fieldName}})` },
  { id: 'Rept', buildExpression: (fieldName) => `REPT({${fieldName}}, 2)` },
  { id: 'Trim', buildExpression: (fieldName) => `TRIM({${fieldName}})` },
  { id: 'Len', buildExpression: (fieldName) => `LEN({${fieldName}})` },
  { id: 'T', buildExpression: (fieldName) => `T({${fieldName}})` },
  {
    id: 'EncodeUrlComponent',
    buildExpression: (fieldName) => `ENCODE_URL_COMPONENT({${fieldName}})`,
  },
];

const buildFormulaName = (funcId: string, fieldName: string): string => `${funcId}_${fieldName}`;

describe('text functions', () => {
  const fieldCases = createFieldTypeCases();
  const matrix = textFunctionCases.flatMap((fn) =>
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
      ...textFunctionCases.flatMap((fn) =>
        fieldCases.map((fieldCase) => ({
          name: buildFormulaName(fn.id, fieldCase.fieldName),
          expression: fn.buildExpression(fieldCase.fieldName),
        }))
      ),
      // Optional parameter tests
      { name: 'FindNoStart', expression: 'FIND("1", {SingleLineText})' },
      { name: 'SearchNoStart', expression: 'SEARCH("1", {SingleLineText})' },
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
    { id: 'FindNoStart', formulaName: 'FindNoStart' },
    { id: 'SearchNoStart', formulaName: 'SearchNoStart' },
  ])('$id uses optional parameter', async ({ id, formulaName }) => {
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
