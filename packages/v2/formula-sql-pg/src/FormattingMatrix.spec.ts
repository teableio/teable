import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Field } from '@teable/v2-core';

import {
  buildFormulaSnapshotContext,
  createFormulaTestContainer,
  createFormulaTestTable,
  type FormulaFieldDefinition,
  type FormulaTestTable,
} from './testkit/FormulaSqlPgTestkit';

type FormatFieldName =
  | 'Number'
  | 'Date'
  | 'LookupNumber'
  | 'LookupDate'
  | 'RollupType'
  | 'ConditionalRollupType'
  | 'FormulaType';

type FormatFunction = 'LEFT' | 'RIGHT';

const fieldFormattedValues: Record<FormatFieldName, string | null> = {
  Number: '10.00',
  Date: '2024/02/03 00:00',
  LookupNumber: null,
  LookupDate: null,
  RollupType: null,
  ConditionalRollupType: null,
  FormulaType: '10.00',
};

const sqlSnippetByField: Record<FormatFieldName, string> = {
  Number: 'to_char',
  Date: 'TO_CHAR',
  LookupNumber: 'to_char',
  LookupDate: 'TO_CHAR',
  RollupType: 'to_char',
  ConditionalRollupType: 'to_char',
  FormulaType: 'to_char',
};

const applyFunction = (fn: FormatFunction, value: string | null): string | null => {
  if (value === null) return null;
  return fn === 'LEFT' ? value.slice(0, 2) : value.slice(-2);
};

const buildFormulaName = (fn: FormatFunction, fieldName: FormatFieldName): string =>
  `${fn}_${fieldName}`;

const replaceFormulaFieldRefs = (expression: string, fieldNameToId: Map<string, string>): string =>
  expression.replace(/\{([^}]+)\}/g, (match, ref) => {
    if (ref.startsWith('fld')) return match;
    const resolved = fieldNameToId.get(ref);
    return resolved ? `{${resolved}}` : match;
  });

const formatCases = (Object.keys(fieldFormattedValues) as Array<FormatFieldName>).flatMap(
  (fieldName) =>
    (['LEFT', 'RIGHT'] as const).map((fn) => {
      const formatted = fieldFormattedValues[fieldName];
      return {
        id: buildFormulaName(fn, fieldName),
        fieldName,
        fn,
        expression: `${fn}({${fieldName}}, 2)`,
        expected: applyFunction(fn, formatted),
        sqlSnippet: sqlSnippetByField[fieldName],
      };
    })
);

describe('formula formatting matrix', () => {
  let container: Awaited<ReturnType<typeof createFormulaTestContainer>>;
  let testTable: FormulaTestTable;

  beforeAll(async () => {
    container = await createFormulaTestContainer();
    const formulaFields: FormulaFieldDefinition[] = formatCases.map((testCase) => ({
      name: testCase.id,
      expression: testCase.expression,
    }));
    testTable = await createFormulaTestTable(container, formulaFields);

    const fieldNameToId = new Map<string, string>(
      testTable.table
        .getFields()
        .map((field: Field) => [field.name().toString(), field.id().toString()])
    );
    for (const [name, definition] of testTable.formulaDefinitions.entries()) {
      testTable.formulaDefinitions.set(name, {
        ...definition,
        expressionWithIds: replaceFormulaFieldRefs(definition.expression, fieldNameToId),
      });
    }
  });

  afterAll(async () => {
    await container.dispose();
  });

  it.each(formatCases)('$id formats $fieldName with $fn', async (testCase) => {
    const context = await buildFormulaSnapshotContext(testTable, testCase.id);
    expect(context.result).toBe(testCase.expected);
    expect(context.sql).toContain(testCase.sqlSnippet);
  });
});
