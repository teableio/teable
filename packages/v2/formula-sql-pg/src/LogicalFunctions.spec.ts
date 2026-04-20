import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  buildFormulaSnapshotContext,
  createFieldTypeCases,
  createFormulaTestContainer,
  createFormulaTestTable,
  executeFormulaAsText,
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
      { name: 'ZeroEqualsBlank', expression: '0 = BLANK()' },
      { name: 'BlankEqualsZero', expression: 'BLANK() = 0' },
      { name: 'ZeroNotEqualsBlank', expression: '0 != BLANK()' },
      { name: 'NumberEqualsBlank', expression: '{Number} = BLANK()' },
      { name: 'NumberNotEqualsBlank', expression: '{Number} != BLANK()' },
      { name: 'NumberBlankIf', expression: 'IF({Number} = BLANK(), 1, 2)' },
      { name: 'BlankNumberIf', expression: 'IF(BLANK() = {Number}, 1, 2)' },
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

  it('does not treat numeric zero as blank in equality comparisons', async () => {
    const tableName = testTable.table.dbTableName()._unsafeUnwrap().value()._unsafeUnwrap();
    const numberField = testTable.fieldsByType.number;
    if (!numberField) throw new Error('Missing Number field');
    const numberColumn = numberField.dbFieldName()._unsafeUnwrap().value()._unsafeUnwrap();
    await sql`
      UPDATE ${sql.table(tableName)}
      SET ${sql.ref(numberColumn)} = ${0}
    `.execute(testTable.db);

    await expect(executeFormulaAsText(testTable, 'ZeroEqualsBlank')).resolves.toBe('false');
    await expect(executeFormulaAsText(testTable, 'BlankEqualsZero')).resolves.toBe('false');
    await expect(executeFormulaAsText(testTable, 'ZeroNotEqualsBlank')).resolves.toBe('true');
    await expect(executeFormulaAsText(testTable, 'NumberEqualsBlank')).resolves.toBe('false');
    await expect(executeFormulaAsText(testTable, 'NumberNotEqualsBlank')).resolves.toBe('true');
  });

  it('treats blank number fields as BLANK() in IF comparisons', async () => {
    const tableName = testTable.table.dbTableName()._unsafeUnwrap().value()._unsafeUnwrap();
    const numberField = testTable.fieldsByType.number;
    if (!numberField) throw new Error('Missing Number field');
    const numberColumn = numberField.dbFieldName()._unsafeUnwrap().value()._unsafeUnwrap();

    await sql`
      UPDATE ${sql.table(tableName)}
      SET ${sql.ref(numberColumn)} = NULL
    `.execute(testTable.db);

    await expect(executeFormulaAsText(testTable, 'NumberBlankIf')).resolves.toBe('1');
    await expect(executeFormulaAsText(testTable, 'BlankNumberIf')).resolves.toBe('1');

    await sql`
      UPDATE ${sql.table(tableName)}
      SET ${sql.ref(numberColumn)} = ${10}
    `.execute(testTable.db);

    await expect(executeFormulaAsText(testTable, 'NumberBlankIf')).resolves.toBe('2');
    await expect(executeFormulaAsText(testTable, 'BlankNumberIf')).resolves.toBe('2');
  });
});
