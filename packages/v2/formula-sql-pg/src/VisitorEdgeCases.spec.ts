import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createFormulaTestContainer,
  createFormulaTestTable,
  executeFormulaAsText,
  type FormulaFieldDefinition,
  type FormulaTestTable,
} from './testkit/FormulaSqlPgTestkit';

describe('FormulaSqlPgVisitor edge cases', () => {
  let container: IV2NodeTestContainer;
  let testTable: FormulaTestTable;

  beforeAll(async () => {
    container = await createFormulaTestContainer();
    const formulaFields: FormulaFieldDefinition[] = [
      // String escape sequences
      { name: 'EscapeNewline', expression: '"hello\\nworld"' },
      { name: 'EscapeCarriageReturn', expression: '"hello\\rworld"' },
      { name: 'EscapeTab', expression: '"hello\\tworld"' },
      { name: 'EscapeBackspace', expression: '"hello\\bworld"' },
      { name: 'EscapeFormFeed', expression: '"hello\\fworld"' },
      { name: 'EscapeVerticalTab', expression: '"hello\\vworld"' },
      { name: 'EscapeBackslash', expression: '"hello\\\\world"' },
      { name: 'EscapeDoubleQuote', expression: '"hello\\"world"' },
      { name: 'EscapeSingleQuote', expression: '"hello\\\'world"' },
      { name: 'EscapeUnknown', expression: '"hello\\xworld"' },
      // Integer and decimal literals
      { name: 'IntegerLiteral', expression: '42' },
      { name: 'NegativeInteger', expression: '-42' },
      { name: 'DecimalLiteral', expression: '3.14' },
      { name: 'NegativeDecimal', expression: '-3.14' },
      // Boolean literals
      { name: 'BooleanTrue', expression: 'TRUE' },
      { name: 'BooleanFalse', expression: 'FALSE' },
      { name: 'BooleanTrueLower', expression: 'true' },
      { name: 'BooleanFalseLower', expression: 'false' },
      // Brackets/parentheses
      { name: 'Brackets', expression: '(10 + 20)' },
      { name: 'NestedBrackets', expression: '((10 + 20) * 2)' },
      // Unary minus
      { name: 'UnaryMinus', expression: '-{Number}' },
      { name: 'UnaryMinusLiteral', expression: '-(10)' },
      // Binary operators
      { name: 'Ampersand', expression: '{SingleLineText} & "suffix"' },
      { name: 'Percent', expression: '10 % 3' },
      // Field references
      { name: 'ValidFieldRef', expression: '{Number} + 1' },
      // Empty string literal
      { name: 'EmptyString', expression: '""' },
      // Complex expressions with whitespace
      { name: 'WhitespaceExpr', expression: '  10 + 20  ' },
    ];
    testTable = await createFormulaTestTable(container, formulaFields);
  });

  afterAll(async () => {
    await container.dispose();
  });

  describe('string escape sequences', () => {
    it('should handle newline escape', async () => {
      const result = await executeFormulaAsText(testTable, 'EscapeNewline');
      expect(result).toBe('hello\nworld');
    });

    it('should handle carriage return escape', async () => {
      const result = await executeFormulaAsText(testTable, 'EscapeCarriageReturn');
      expect(result).toBe('hello\rworld');
    });

    it('should handle tab escape', async () => {
      const result = await executeFormulaAsText(testTable, 'EscapeTab');
      expect(result).toBe('hello\tworld');
    });

    it('should handle backspace escape', async () => {
      const result = await executeFormulaAsText(testTable, 'EscapeBackspace');
      expect(result).toBe('hello\bworld');
    });

    it('should handle form feed escape', async () => {
      const result = await executeFormulaAsText(testTable, 'EscapeFormFeed');
      expect(result).toBe('hello\fworld');
    });

    it('should handle vertical tab escape', async () => {
      const result = await executeFormulaAsText(testTable, 'EscapeVerticalTab');
      expect(result).toBe('hello\vworld');
    });

    it('should handle backslash escape', async () => {
      const result = await executeFormulaAsText(testTable, 'EscapeBackslash');
      expect(result).toBe('hello\\world');
    });

    it('should handle double quote escape', async () => {
      const result = await executeFormulaAsText(testTable, 'EscapeDoubleQuote');
      expect(result).toBe('hello"world');
    });

    it('should handle single quote escape', async () => {
      const result = await executeFormulaAsText(testTable, 'EscapeSingleQuote');
      expect(result).toBe("hello'world");
    });

    it('should preserve unknown escape sequences', async () => {
      const result = await executeFormulaAsText(testTable, 'EscapeUnknown');
      expect(result).toBe('hello\\xworld');
    });
  });

  describe('numeric literals', () => {
    it('should handle integer literals', async () => {
      const result = await executeFormulaAsText(testTable, 'IntegerLiteral');
      expect(result).toBe('42');
    });

    it('should handle negative integers', async () => {
      const result = await executeFormulaAsText(testTable, 'NegativeInteger');
      expect(result).toBe('-42');
    });

    it('should handle decimal literals', async () => {
      const result = await executeFormulaAsText(testTable, 'DecimalLiteral');
      expect(result).toBe('3.14');
    });

    it('should handle negative decimals', async () => {
      const result = await executeFormulaAsText(testTable, 'NegativeDecimal');
      expect(result).toBe('-3.14');
    });
  });

  describe('boolean literals', () => {
    it('should handle TRUE', async () => {
      const result = await executeFormulaAsText(testTable, 'BooleanTrue');
      expect(result?.toUpperCase()).toBe('TRUE');
    });

    it('should handle FALSE', async () => {
      const result = await executeFormulaAsText(testTable, 'BooleanFalse');
      expect(result?.toUpperCase()).toBe('FALSE');
    });

    it('should handle lowercase true', async () => {
      const result = await executeFormulaAsText(testTable, 'BooleanTrueLower');
      expect(result?.toUpperCase()).toBe('TRUE');
    });

    it('should handle lowercase false', async () => {
      const result = await executeFormulaAsText(testTable, 'BooleanFalseLower');
      expect(result?.toUpperCase()).toBe('FALSE');
    });
  });

  describe('brackets and unary operators', () => {
    it('should handle brackets', async () => {
      const result = await executeFormulaAsText(testTable, 'Brackets');
      expect(result).toBe('30');
    });

    it('should handle nested brackets', async () => {
      const result = await executeFormulaAsText(testTable, 'NestedBrackets');
      expect(result).toBe('60');
    });

    it('should handle unary minus on field', async () => {
      const result = await executeFormulaAsText(testTable, 'UnaryMinus');
      expect(result).toBe('-10');
    });

    it('should handle unary minus on literal', async () => {
      const result = await executeFormulaAsText(testTable, 'UnaryMinusLiteral');
      expect(result).toBe('-10');
    });
  });

  describe('binary operators', () => {
    it('should handle ampersand concatenation', async () => {
      const result = await executeFormulaAsText(testTable, 'Ampersand');
      expect(result).toBe('10suffix');
    });

    it('should handle percent/modulo', async () => {
      const result = await executeFormulaAsText(testTable, 'Percent');
      expect(result).toBe('1');
    });
  });

  describe('misc expressions', () => {
    it('should handle empty string', async () => {
      const result = await executeFormulaAsText(testTable, 'EmptyString');
      expect(result).toBe('');
    });

    it('should handle whitespace in expressions', async () => {
      const result = await executeFormulaAsText(testTable, 'WhitespaceExpr');
      expect(result).toBe('30');
    });
  });
});

describe('FormulaSqlPgVisitor error handling', () => {
  let container: IV2NodeTestContainer;
  let testTable: FormulaTestTable;

  beforeAll(async () => {
    container = await createFormulaTestContainer();
    testTable = await createFormulaTestTable(container, []);
  });

  afterAll(async () => {
    await container.dispose();
  });

  it('should handle invalid field reference via translator', () => {
    // Test directly via translator, since CreateFieldCommand validates field references
    const result = testTable.translator.translateExpression('{NonExistentField}');
    expect(result.isOk()).toBe(true);
    const expr = result._unsafeUnwrap();
    expect(expr.errorConditionSql).toBe('TRUE');
    expect(expr.errorMessageSql).toContain('#ERROR:REF:missing_field');
  });

  it('should handle unknown function via translator', () => {
    const result = testTable.translator.translateExpression('UNKNOWN_FUNC(1, 2)');
    expect(result.isOk()).toBe(true);
    const expr = result._unsafeUnwrap();
    expect(expr.errorConditionSql).toBe('TRUE');
    expect(expr.errorMessageSql).toContain('#ERROR:NOT_IMPL');
  });
});
