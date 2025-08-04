/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable sonarjs/no-duplicate-string */
import { plainToInstance } from 'class-transformer';
import { describe, it, expect } from 'vitest';
import { FieldType, CellValueType, DbFieldType } from '../models';
import { FormulaFieldCore } from '../models/field/derivate/formula.field';
import { NumberFieldCore } from '../models/field/derivate/number.field';
import { CircularReferenceError } from './errors/circular-reference.error';
import type { IFormulaConversionContext } from './function-convertor.interface';
import {
  GeneratedColumnSqlConversionVisitor,
  SelectColumnSqlConversionVisitor,
} from './sql-conversion.visitor';

// Helper functions to create field instances
function createNumberField(id: string, dbFieldName: string = id): NumberFieldCore {
  return plainToInstance(NumberFieldCore, {
    id,
    name: id,
    type: FieldType.Number,
    dbFieldName,
    dbFieldType: DbFieldType.Real,
    cellValueType: CellValueType.Number,
    options: { formatting: { type: 'decimal', precision: 2 } },
  });
}

function createFormulaField(
  id: string,
  expression: string,
  dbGenerated: boolean = true,
  dbFieldName: string = id
): FormulaFieldCore {
  return plainToInstance(FormulaFieldCore, {
    id,
    name: id,
    type: FieldType.Formula,
    dbFieldName,
    dbFieldType: DbFieldType.Real,
    cellValueType: CellValueType.Number,
    options: { expression, dbGenerated },
  });
}

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
      const fieldMap = new Map();
      fieldMap.set('field1', createNumberField('field1'));
      const context: IFormulaConversionContext = {
        fieldMap,
      };

      const result = parseAndConvertGenerated('{field1} + 10', context);
      expect(result).toBe('("field1" + 10)');
    });

    it('should handle multiple field references', () => {
      const fieldMap = new Map();
      fieldMap.set('field1', createNumberField('field1'));
      fieldMap.set('field2', createNumberField('field2'));
      const context: IFormulaConversionContext = {
        fieldMap,
      };

      const result = parseAndConvertGenerated('{field1} + {field2}', context);
      expect(result).toBe('("field1" + "field2")');
    });
  });

  describe('recursive formula expansion', () => {
    it('should expand a simple formula field reference', () => {
      const fieldMap = new Map();
      fieldMap.set('field1', createNumberField('field1'));
      fieldMap.set('field2', createFormulaField('field2', '{field1} + 10'));
      const context: IFormulaConversionContext = {
        fieldMap,
      };

      const result = parseAndConvertGenerated('{field2} * 2', context);
      expect(result).toBe('(("field1" + 10) * 2)');
    });

    it('should handle nested formula references', () => {
      const fieldMap = new Map();
      fieldMap.set('field1', createNumberField('field1'));
      fieldMap.set('field2', createFormulaField('field2', '{field1} + 10'));
      fieldMap.set('field3', createFormulaField('field3', '{field2} * 2'));
      const context: IFormulaConversionContext = {
        fieldMap,
      };

      const result = parseAndConvertGenerated('{field3} + 5', context);
      expect(result).toBe('((("field1" + 10) * 2) + 5)');
    });

    it('should preserve non-formula field references', () => {
      const fieldMap = new Map();
      fieldMap.set('field1', createNumberField('field1'));
      fieldMap.set('field2', createFormulaField('field2', '{field1} + 10'));
      const context: IFormulaConversionContext = {
        fieldMap,
      };

      const result = parseAndConvertGenerated('{field1} + {field2}', context);
      expect(result).toBe('("field1" + ("field1" + 10))');
    });

    it('should handle formula fields without dbGenerated flag', () => {
      const fieldMap = new Map();
      fieldMap.set('field1', createNumberField('field1'));
      fieldMap.set('field2', createFormulaField('field2', '{field1} + 10', false));
      const context: IFormulaConversionContext = {
        fieldMap,
      };

      const result = parseAndConvertGenerated('{field1} + {field2}', context);
      expect(result).toBe('("field1" + "field2")');
    });

    it('should cache expanded expressions', () => {
      const fieldMap = new Map();
      fieldMap.set('field1', createNumberField('field1'));
      fieldMap.set('field2', createFormulaField('field2', '{field1} + 10'));
      const context: IFormulaConversionContext = {
        fieldMap,
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
      const fieldMap = new Map();
      // Create a formula field with invalid options (this would be handled by the system)
      const invalidFormulaField = plainToInstance(FormulaFieldCore, {
        id: 'field1',
        name: 'field1',
        type: FieldType.Formula,
        dbFieldName: 'field1',
        dbFieldType: DbFieldType.Real,
        cellValueType: CellValueType.Number,
        options: { expression: '', dbGenerated: false }, // Invalid/empty expression
      });
      fieldMap.set('field1', invalidFormulaField);
      const context: IFormulaConversionContext = {
        fieldMap,
      };

      // Since options parsing fails in the dbGenerated check, it falls back to normal field reference
      const result = parseAndConvertGenerated('{field1}', context);
      expect(result).toBe('"field1"');
    });

    it('should detect circular references', () => {
      const fieldMap = new Map();
      fieldMap.set(
        'field1',
        createFormulaField('field1', '{field2} + 1', true, '__generated_field1')
      );
      fieldMap.set(
        'field2',
        createFormulaField('field2', '{field1} + 1', true, '__generated_field2')
      );
      const context: IFormulaConversionContext = {
        fieldMap,
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
      const fieldMap = new Map();
      fieldMap.set(
        'field1',
        createFormulaField('field1', '{field2} + 1', true, '__generated_field1')
      );
      fieldMap.set(
        'field2',
        createFormulaField('field2', '{field3} * 2', true, '__generated_field2')
      );
      fieldMap.set(
        'field3',
        createFormulaField('field3', '{field1} / 2', true, '__generated_field3')
      );
      const context: IFormulaConversionContext = {
        fieldMap,
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
      const fieldMap = new Map();
      fieldMap.set('field1', createNumberField('field1'));
      fieldMap.set('field2', createFormulaField('field2', '{field1} + 10'));
      const context: IFormulaConversionContext = {
        fieldMap,
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
      const fieldMap = new Map();
      fieldMap.set('field1', createNumberField('field1'));
      fieldMap.set('field2', createFormulaField('field2', '{field1} + 10'));
      const context: IFormulaConversionContext = {
        fieldMap,
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
