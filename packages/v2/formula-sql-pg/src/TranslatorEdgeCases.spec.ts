import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ok } from 'neverthrow';

import { FormulaSqlPgTranslator } from './FormulaSqlPgTranslator';
import { makeExpr } from './SqlExpression';
import { Pg16TypeValidationStrategy } from './strategies';
import {
  createFormulaTestContainer,
  createFormulaTestTable,
  executeFormulaAsText,
  type FormulaFieldDefinition,
  type FormulaTestTable,
} from './testkit/FormulaSqlPgTestkit';

let container: IV2NodeTestContainer;
let testTable: FormulaTestTable;

beforeAll(async () => {
  container = await createFormulaTestContainer();
  const formulaFields: FormulaFieldDefinition[] = [
    { name: 'ArrayFormula', expression: '{MultipleSelect}' },
    { name: 'BaseFormula', expression: '{Number} * 2' },
    { name: 'NestedFormula', expression: '{BaseFormula} + 10' },
    { name: 'ErrorFormula', expression: '1 / 0' },
    { name: 'FieldByName', expression: '{Number} + {SingleLineText}' },
  ];
  testTable = await createFormulaTestTable(container, formulaFields, {
    profile: 'minimal',
    fieldTypes: ['singleLineText', 'number', 'multipleSelect'],
  });
});

afterAll(async () => {
  await container.dispose();
});

describe('FormulaSqlPgTranslator edge cases', () => {
  describe('renderSql', () => {
    it('should render array result with error handling', async () => {
      const result = await executeFormulaAsText(testTable, 'ArrayFormula');
      // Should return stringified array
      expect(result).toContain('10');
      expect(result).toContain('20');
    });

    it('should handle division by zero error', async () => {
      const result = await executeFormulaAsText(testTable, 'ErrorFormula');
      expect(result).toContain('#ERROR:DIV0');
    });
  });

  describe('formula field resolution', () => {
    it('should resolve nested formula references', async () => {
      const result = await executeFormulaAsText(testTable, 'NestedFormula');
      // BaseFormula = 10 * 2 = 20, NestedFormula = 20 + 10 = 30
      expect(result).toBe('30');
    });
  });

  describe('field resolution by name', () => {
    it('should resolve field by name when id not found', async () => {
      const result = await executeFormulaAsText(testTable, 'FieldByName');
      // Number = 10, SingleLineText = '10' - with + operator this becomes string concatenation
      expect(result).toBe('1010');
    });
  });
});

describe('FormulaSqlPgTranslator options', () => {
  it('should create translator with skipFormulaExpansion option', () => {
    const translator = new FormulaSqlPgTranslator({
      table: testTable.table,
      tableAlias: 't',
      typeValidationStrategy: new Pg16TypeValidationStrategy(),
      timeZone: 'utc',
      skipFormulaExpansion: true,
      resolveFieldSql: (field) =>
        ok(makeExpr(`"t"."col"`, 'unknown', false, undefined, undefined, field)),
    });

    expect(translator.tableAlias).toBe('t');
    expect(translator.timeZone).toBe('utc');
  });

  it('should create translator with allowFieldNameFallback = false', () => {
    const translator = new FormulaSqlPgTranslator({
      table: testTable.table,
      tableAlias: 't',
      typeValidationStrategy: new Pg16TypeValidationStrategy(),
      allowFieldNameFallback: false,
      resolveFieldSql: (field) =>
        ok(makeExpr(`"t"."col"`, 'unknown', false, undefined, undefined, field)),
    });

    // Try to resolve a non-existent field by name - should fail
    const result = translator.resolveFieldById('NonExistentField');
    expect(result.isErr()).toBe(true);
  });

  it('should handle default timeZone', () => {
    const translator = new FormulaSqlPgTranslator({
      table: testTable.table,
      tableAlias: 't',
      typeValidationStrategy: new Pg16TypeValidationStrategy(),
      resolveFieldSql: (field) =>
        ok(makeExpr(`"t"."col"`, 'unknown', false, undefined, undefined, field)),
    });

    expect(translator.timeZone).toBe('utc');
  });
});

describe('FormulaSqlPgTranslator parse errors', () => {
  it('should return error for invalid formula syntax', () => {
    const result = testTable.translator.translateExpression('INVALID(((');
    expect(result.isErr()).toBe(true);
  });

  it('should return error for unclosed parenthesis', () => {
    const result = testTable.translator.translateExpression('SUM(1, 2');
    expect(result.isErr()).toBe(true);
  });

  it('should return error for unclosed string', () => {
    const result = testTable.translator.translateExpression('"unclosed');
    expect(result.isErr()).toBe(true);
  });
});
