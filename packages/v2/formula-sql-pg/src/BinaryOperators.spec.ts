import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  buildFormulaSnapshotContext,
  createFieldTypeCases,
  createFormulaTestContainer,
  createFormulaTestTable,
  type FieldTypeCase,
  type FormulaFieldDefinition,
  type FormulaTestTable,
} from './testkit/FormulaSqlPgTestkit';

type ComparisonOperatorCase = {
  id: string;
  operator: string;
  buildExpression: (leftFieldName: string, rightFieldName: string) => string;
};

const comparisonOperatorCases: ReadonlyArray<ComparisonOperatorCase> = [
  { id: 'Eq', operator: '=', buildExpression: (l, r) => `{${l}} = {${r}}` },
  { id: 'Neq', operator: '!=', buildExpression: (l, r) => `{${l}} != {${r}}` },
  { id: 'Gt', operator: '>', buildExpression: (l, r) => `{${l}} > {${r}}` },
  { id: 'Gte', operator: '>=', buildExpression: (l, r) => `{${l}} >= {${r}}` },
  { id: 'Lt', operator: '<', buildExpression: (l, r) => `{${l}} < {${r}}` },
  { id: 'Lte', operator: '<=', buildExpression: (l, r) => `{${l}} <= {${r}}` },
];

const buildFormulaName = (opId: string, leftFieldName: string, rightFieldName: string): string =>
  `Compare_${opId}_${leftFieldName}_${rightFieldName}`;

/**
 * Selects representative field type pairs for testing binary operators.
 * This reduces the test matrix from 210 pairs to ~50 pairs while maintaining coverage:
 * - All same-type pairs (20 pairs) - ensures operators work with identical types
 * - Key cross-type pairs (30 pairs) - covers common type coercion scenarios
 */
const selectRepresentativeFieldPairs = (
  fieldCases: ReadonlyArray<FieldTypeCase>
): ReadonlyArray<{
  leftCase: FieldTypeCase;
  rightCase: FieldTypeCase;
}> => {
  const pairs: Array<{
    leftCase: FieldTypeCase;
    rightCase: FieldTypeCase;
  }> = [];

  // 1. All same-type pairs (diagonal)
  for (const fieldCase of fieldCases) {
    pairs.push({ leftCase: fieldCase, rightCase: fieldCase });
  }

  // 2. Key cross-type pairs for common coercion scenarios
  const keyTypes = [
    'singleLineText',
    'number',
    'checkbox',
    'date',
    'singleSelect',
    'multipleSelect',
    'attachment',
    'user',
    'link',
    'formula',
  ] as const;

  const keyTypeCases = fieldCases.filter((c) =>
    keyTypes.includes(c.type as (typeof keyTypes)[number])
  );

  // Cross-type pairs between key types (excluding same-type which we already have)
  for (let i = 0; i < keyTypeCases.length; i++) {
    for (let j = i + 1; j < keyTypeCases.length; j++) {
      pairs.push({ leftCase: keyTypeCases[i]!, rightCase: keyTypeCases[j]! });
    }
  }

  // 3. Add a few edge cases: number with text-like types
  const numberCase = fieldCases.find((c) => c.type === 'number');
  const textCase = fieldCases.find((c) => c.type === 'singleLineText');
  const longTextCase = fieldCases.find((c) => c.type === 'longText');
  const ratingCase = fieldCases.find((c) => c.type === 'rating');
  const autoNumberCase = fieldCases.find((c) => c.type === 'autoNumber');

  if (numberCase) {
    if (textCase) pairs.push({ leftCase: numberCase, rightCase: textCase });
    if (longTextCase) pairs.push({ leftCase: numberCase, rightCase: longTextCase });
    if (ratingCase) pairs.push({ leftCase: numberCase, rightCase: ratingCase });
    if (autoNumberCase) pairs.push({ leftCase: numberCase, rightCase: autoNumberCase });
  }

  return pairs;
};

describe('binary comparison operators', () => {
  const fieldCases = createFieldTypeCases();
  const fieldPairs = selectRepresentativeFieldPairs(fieldCases);
  const matrix = comparisonOperatorCases.flatMap((op) =>
    fieldPairs.map(({ leftCase, rightCase }) => ({
      opId: op.id,
      operator: op.operator,
      leftCase,
      rightCase,
      formulaName: buildFormulaName(op.id, leftCase.fieldName, rightCase.fieldName),
    }))
  );

  let container: IV2NodeTestContainer;
  let testTable: FormulaTestTable;

  beforeAll(async () => {
    container = await createFormulaTestContainer();
    const formulaFields: FormulaFieldDefinition[] = comparisonOperatorCases.flatMap((op) =>
      fieldPairs.map(({ leftCase, rightCase }) => ({
        name: buildFormulaName(op.id, leftCase.fieldName, rightCase.fieldName),
        expression: op.buildExpression(leftCase.fieldName, rightCase.fieldName),
      }))
    );
    testTable = await createFormulaTestTable(container, formulaFields);
  });

  afterAll(async () => {
    await container.dispose();
  });

  it.each(matrix)(
    '$opId $leftCase.type $operator $rightCase.type',
    async ({ opId, operator, leftCase, rightCase, formulaName }) => {
      const context = await buildFormulaSnapshotContext(testTable, formulaName);
      expect({
        opId,
        operator,
        leftType: leftCase.type,
        rightType: rightCase.type,
        formula: context.formula,
        sql: context.sql,
        inputs: context.inputs,
        result: context.result,
      }).toMatchSnapshot();
    }
  );
});
