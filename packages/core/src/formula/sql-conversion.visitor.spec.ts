/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable sonarjs/no-duplicate-string */
import { describe, it, expect } from 'vitest';
import { FormulaFieldCore } from '../models/field/derivate/formula.field';
import { CircularReferenceError } from './errors/circular-reference.error';
import type { IFormulaConversionContext } from './function-convertor.interface';
import {
  GeneratedColumnSqlConversionVisitor,
  SelectColumnSqlConversionVisitor,
} from './sql-conversion.visitor';

// Mock implementation of IGeneratedColumnQueryInterface for testing
class MockGeneratedColumnQuery {
  fieldReference(fieldId: string, columnName: string): string {
    return `"${columnName}"`;
  }

  add(left: string, right: string): string {
    return `(${left} + ${right})`;
  }

  subtract(left: string, right: string): string {
    return `(${left} - ${right})`;
  }

  multiply(left: string, right: string): string {
    return `(${left} * ${right})`;
  }

  divide(left: string, right: string): string {
    return `(${left} / ${right})`;
  }

  numberLiteral(value: number): string {
    return value.toString();
  }

  stringLiteral(value: string): string {
    return `'${value}'`;
  }

  booleanLiteral(value: boolean): string {
    return value.toString();
  }

  // Add other required methods as needed
  [key: string]: any;
}

// Mock implementation of ISelectQueryInterface for testing
class MockSelectQuery extends MockGeneratedColumnQuery {
  // SelectQuery can have different implementations but for testing we'll use the same
}

describe('SQL Conversion Visitor', () => {
  const mockGeneratedQuery = new MockGeneratedColumnQuery() as any;
  const mockSelectQuery = new MockSelectQuery() as any;

  const parseAndConvertGenerated = (
    expression: string,
    context: IFormulaConversionContext
  ): string => {
    const visitor = new GeneratedColumnSqlConversionVisitor(mockGeneratedQuery, context);
    const tree = FormulaFieldCore.parse(expression);
    return tree.accept(visitor);
  };

  const parseAndConvertSelect = (
    expression: string,
    context: IFormulaConversionContext
  ): string => {
    const visitor = new SelectColumnSqlConversionVisitor(mockSelectQuery, context);
    const tree = FormulaFieldCore.parse(expression);
    return tree.accept(visitor);
  };

  describe('basic field references', () => {
    it('should handle simple field references', () => {
      const context: IFormulaConversionContext = {
        fieldMap: {
          field1: { columnName: 'field1', fieldType: 'number' },
        },
      };

      const result = parseAndConvertGenerated('{field1} + 10', context);
      expect(result).toBe('("field1" + 10)');
    });

    it('should handle multiple field references', () => {
      const context: IFormulaConversionContext = {
        fieldMap: {
          field1: { columnName: 'field1', fieldType: 'number' },
          field2: { columnName: 'field2', fieldType: 'number' },
        },
      };

      const result = parseAndConvertGenerated('{field1} + {field2}', context);
      expect(result).toBe('("field1" + "field2")');
    });
  });

  describe('recursive formula expansion', () => {
    it('should expand a simple formula field reference', () => {
      const context: IFormulaConversionContext = {
        fieldMap: {
          field1: { columnName: 'field1', fieldType: 'number' },
          field2: {
            columnName: 'field2',
            fieldType: 'formula',
            options: '{"expression": "{field1} + 10", "dbGenerated": true}',
          },
        },
      };

      const result = parseAndConvertGenerated('{field2} * 2', context);
      expect(result).toBe('(("field1" + 10) * 2)');
    });

    it('should handle nested formula references', () => {
      const context: IFormulaConversionContext = {
        fieldMap: {
          field1: { columnName: 'field1', fieldType: 'number' },
          field2: {
            columnName: 'field2',
            fieldType: 'formula',
            options: '{"expression": "{field1} + 10", "dbGenerated": true}',
          },
          field3: {
            columnName: 'field3',
            fieldType: 'formula',
            options: '{"expression": "{field2} * 2", "dbGenerated": true}',
          },
        },
      };

      const result = parseAndConvertGenerated('{field3} + 5', context);
      expect(result).toBe('((("field1" + 10) * 2) + 5)');
    });

    it('should preserve non-formula field references', () => {
      const context: IFormulaConversionContext = {
        fieldMap: {
          field1: { columnName: 'field1', fieldType: 'number' },
          field2: {
            columnName: 'field2',
            fieldType: 'formula',
            options: '{"expression": "{field1} + 10", "dbGenerated": true}',
          },
        },
      };

      const result = parseAndConvertGenerated('{field1} + {field2}', context);
      expect(result).toBe('("field1" + ("field1" + 10))');
    });

    it('should handle formula fields without dbGenerated flag', () => {
      const context: IFormulaConversionContext = {
        fieldMap: {
          field1: { columnName: 'field1', fieldType: 'number' },
          field2: {
            columnName: 'field2',
            fieldType: 'formula',
            options: '{"expression": "{field1} + 10", "dbGenerated": false}',
          },
        },
      };

      const result = parseAndConvertGenerated('{field1} + {field2}', context);
      expect(result).toBe('("field1" + "field2")');
    });

    it('should cache expanded expressions', () => {
      const context: IFormulaConversionContext = {
        fieldMap: {
          field1: { columnName: 'field1', fieldType: 'number' },
          field2: {
            columnName: 'field2',
            fieldType: 'formula',
            options: '{"expression": "{field1} + 10", "dbGenerated": true}',
          },
        },
      };

      // First expansion
      const result1 = parseAndConvertGenerated('{field2}', context);

      // Check cache
      expect(context.expansionCache?.has('field2')).toBe(true);
      expect(context.expansionCache?.get('field2')).toBe('("field1" + 10)');

      // Second expansion should use cache
      const result2 = parseAndConvertGenerated('{field2} * 2', context);

      expect(result1).toBe('("field1" + 10)');
      expect(result2).toBe('(("field1" + 10) * 2)');
    });

    it('should handle invalid field options gracefully', () => {
      const context: IFormulaConversionContext = {
        fieldMap: {
          field1: {
            columnName: 'field1',
            fieldType: 'formula',
            options: 'invalid json',
          },
        },
      };

      // Since options parsing fails in the dbGenerated check, it falls back to normal field reference
      const result = parseAndConvertGenerated('{field1}', context);
      expect(result).toBe('"field1"');
    });

    it('should detect circular references', () => {
      const context: IFormulaConversionContext = {
        fieldMap: {
          field1: {
            columnName: '__generated_field1',
            fieldType: 'formula',
            options: '{"expression": "{field2} + 1", "dbGenerated": true}',
          },
          field2: {
            columnName: '__generated_field2',
            fieldType: 'formula',
            options: '{"expression": "{field1} + 1", "dbGenerated": true}',
          },
        },
      };

      try {
        parseAndConvertGenerated('{field1}', context);
        expect.fail('Should have thrown CircularReferenceError');
      } catch (error) {
        expect(error).toBeInstanceOf(CircularReferenceError);
        const circularError = error as CircularReferenceError;
        expect(circularError.fieldId).toBe('field1');
        expect(circularError.expansionStack).toEqual(['field1', 'field2']);
        expect(circularError.getCircularChain()).toEqual(['field1', 'field2', 'field1']);
      }
    });

    it('should detect complex circular references', () => {
      const context: IFormulaConversionContext = {
        fieldMap: {
          field1: {
            columnName: '__generated_field1',
            fieldType: 'formula',
            options: '{"expression": "{field2} + 1", "dbGenerated": true}',
          },
          field2: {
            columnName: '__generated_field2',
            fieldType: 'formula',
            options: '{"expression": "{field3} * 2", "dbGenerated": true}',
          },
          field3: {
            columnName: '__generated_field3',
            fieldType: 'formula',
            options: '{"expression": "{field1} / 2", "dbGenerated": true}',
          },
        },
      };

      try {
        parseAndConvertGenerated('{field1}', context);
        expect.fail('Should have thrown CircularReferenceError');
      } catch (error) {
        expect(error).toBeInstanceOf(CircularReferenceError);
        const circularError = error as CircularReferenceError;
        expect(circularError.fieldId).toBe('field1');
        expect(circularError.expansionStack).toEqual(['field1', 'field2', 'field3']);
        expect(circularError.getCircularChain()).toEqual(['field1', 'field2', 'field3', 'field1']);
        expect(circularError.getCircularDescription()).toBe(
          'Circular reference: field1 → field2 → field3 → field1'
        );
      }
    });
  });

  describe('both visitor types should work the same', () => {
    it('should work for both GeneratedColumnSqlConversionVisitor and SelectColumnSqlConversionVisitor', () => {
      const context: IFormulaConversionContext = {
        fieldMap: {
          field1: { columnName: 'field1', fieldType: 'number' },
          field2: {
            columnName: 'field2',
            fieldType: 'formula',
            options: '{"expression": "{field1} + 10", "dbGenerated": true}',
          },
        },
      };

      const generatedResult = parseAndConvertGenerated('{field2} * 2', context);

      // Reset cache for second test
      context.expansionCache = new Map();

      const selectResult = parseAndConvertSelect('{field2} * 2', context);

      expect(generatedResult).toBe(selectResult);
      expect(generatedResult).toBe('(("field1" + 10) * 2)');
    });
  });

  describe('dependency tracking', () => {
    it('should track dependencies in GeneratedColumnSqlConversionVisitor', () => {
      const context: IFormulaConversionContext = {
        fieldMap: {
          field1: { columnName: 'field1', fieldType: 'number' },
          field2: {
            columnName: 'field2',
            fieldType: 'formula',
            options: '{"expression": "{field1} + 10", "dbGenerated": true}',
          },
        },
      };

      const visitor = new GeneratedColumnSqlConversionVisitor(mockGeneratedQuery, context);
      const tree = FormulaFieldCore.parse('{field1} + {field2}');
      tree.accept(visitor);

      const result = visitor.getResult('dummy_sql');
      expect(result.dependencies).toContain('field1');
      expect(result.dependencies).toContain('field2');
    });
  });
});
