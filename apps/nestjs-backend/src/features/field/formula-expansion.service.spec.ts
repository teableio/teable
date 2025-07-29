/* eslint-disable sonarjs/no-duplicate-string */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { FieldType } from '@teable/core';
import { describe, beforeEach, it, expect } from 'vitest';
import { FormulaExpansionService } from './formula-expansion.service';
import type { IFieldForExpansion } from './formula-expansion.service';

describe('FormulaExpansionService', () => {
  let service: FormulaExpansionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FormulaExpansionService],
    }).compile();

    service = module.get<FormulaExpansionService>(FormulaExpansionService);
  });

  describe('expandFormulaExpression', () => {
    it('should expand simple formula reference (matches example in JSDoc)', () => {
      // This test corresponds to the first example in the JSDoc comment:
      // field1: regular field, field2: formula "{field1} + 10", expanding "{field2} * 2"
      const fields: IFieldForExpansion[] = [
        {
          id: 'fld1',
          type: FieldType.SingleLineText,
          dbFieldName: 'field1',
          options: null,
        },
        {
          id: 'fld2',
          type: FieldType.Formula,
          dbFieldName: 'field2',
          options: JSON.stringify({ expression: '{fld1} + 10', dbGenerated: true }),
        },
      ];

      const context = service.createExpansionContext(fields);
      const result = service.expandFormulaExpression('{fld2} * 2', context);

      expect(result).toBe('({fld1} + 10) * 2');
    });

    it('should expand nested formula references (matches nested example in JSDoc)', () => {
      // This test corresponds to the nested example in the JSDoc comment:
      // field1 -> field2 -> field3, expanding "{field3} + 5" should result in deeply nested expansion
      const fields: IFieldForExpansion[] = [
        {
          id: 'fld1',
          type: FieldType.SingleLineText,
          dbFieldName: 'field1',
          options: null,
        },
        {
          id: 'fld2',
          type: FieldType.Formula,
          dbFieldName: 'field2',
          options: JSON.stringify({ expression: '{fld1} + 10', dbGenerated: true }),
        },
        {
          id: 'fld3',
          type: FieldType.Formula,
          dbFieldName: 'field3',
          options: JSON.stringify({ expression: '{fld2} * 2', dbGenerated: true }),
        },
      ];

      const context = service.createExpansionContext(fields);
      const result = service.expandFormulaExpression('{fld3} + 5', context);

      expect(result).toBe('(({fld1} + 10) * 2) + 5');
    });

    it('should handle mixed formula and non-formula references', () => {
      // Tests expansion when formula references both formula fields and regular fields
      const fields: IFieldForExpansion[] = [
        {
          id: 'fld1',
          type: FieldType.SingleLineText,
          dbFieldName: 'field1',
          options: null,
        },
        {
          id: 'fld2',
          type: FieldType.Number,
          dbFieldName: 'field2',
          options: null,
        },
        {
          id: 'fld3',
          type: FieldType.Formula,
          dbFieldName: 'field3',
          options: JSON.stringify({ expression: '{fld1} + {fld2}', dbGenerated: true }),
        },
      ];

      const context = service.createExpansionContext(fields);
      const result = service.expandFormulaExpression('{fld3} * 10', context);

      expect(result).toBe('({fld1} + {fld2}) * 10');
    });

    it('should detect circular references', () => {
      // Tests that circular references are properly detected and throw an error
      const fields: IFieldForExpansion[] = [
        {
          id: 'fld1',
          type: FieldType.Formula,
          dbFieldName: 'field1',
          options: JSON.stringify({ expression: '{fld2} + 1', dbGenerated: true }),
        },
        {
          id: 'fld2',
          type: FieldType.Formula,
          dbFieldName: 'field2',
          options: JSON.stringify({ expression: '{fld1} + 1', dbGenerated: true }),
        },
      ];

      const context = service.createExpansionContext(fields);

      expect(() => {
        service.expandFormulaExpression('{fld1} * 2', context);
      }).toThrow(/Circular reference detected involving field/);
    });

    it('should handle complex expressions with multiple references', () => {
      // Tests expansion when a single expression references multiple formula fields
      const fields: IFieldForExpansion[] = [
        {
          id: 'fld1',
          type: FieldType.Number,
          dbFieldName: 'field1',
          options: null,
        },
        {
          id: 'fld2',
          type: FieldType.Number,
          dbFieldName: 'field2',
          options: null,
        },
        {
          id: 'fld3',
          type: FieldType.Formula,
          dbFieldName: 'field3',
          options: JSON.stringify({ expression: '{fld1} + {fld2}', dbGenerated: true }),
        },
        {
          id: 'fld4',
          type: FieldType.Formula,
          dbFieldName: 'field4',
          options: JSON.stringify({ expression: '{fld1} * {fld2}', dbGenerated: true }),
        },
      ];

      const context = service.createExpansionContext(fields);
      const result = service.expandFormulaExpression('{fld3} + {fld4}', context);

      expect(result).toBe('({fld1} + {fld2}) + ({fld1} * {fld2})');
    });

    it('should match the exact JSDoc example scenario', () => {
      // This test exactly matches the scenario described in the JSDoc comment
      const fields: IFieldForExpansion[] = [
        {
          id: 'field1',
          type: FieldType.Number,
          dbFieldName: 'field1',
          options: null,
        },
        {
          id: 'field2',
          type: FieldType.Formula,
          dbFieldName: 'field2',
          options: JSON.stringify({ expression: '{field1} + 10', dbGenerated: true }),
        },
        {
          id: 'field3',
          type: FieldType.Formula,
          dbFieldName: 'field3',
          options: JSON.stringify({ expression: '{field2} * 2', dbGenerated: true }),
        },
        {
          id: 'field4',
          type: FieldType.Formula,
          dbFieldName: 'field4',
          options: JSON.stringify({ expression: '{field3} + 5', dbGenerated: true }),
        },
      ];

      const context = service.createExpansionContext(fields);

      // Test the first example: expanding field3's expression
      const result1 = service.expandFormulaExpression('{field2} * 2', context);
      expect(result1).toBe('({field1} + 10) * 2');

      // Test the nested example: expanding field4's expression
      const result2 = service.expandFormulaExpression('{field3} + 5', context);
      expect(result2).toBe('(({field1} + 10) * 2) + 5');
    });
  });

  describe('shouldExpandFormula', () => {
    it('should return true for formula field referencing other formula fields with dbGenerated=true', () => {
      const fields: IFieldForExpansion[] = [
        {
          id: 'fld1',
          type: FieldType.Formula,
          dbFieldName: 'field1',
          options: JSON.stringify({ expression: '1 + 1', dbGenerated: true }),
        },
        {
          id: 'fld2',
          type: FieldType.Formula,
          dbFieldName: 'field2',
          options: JSON.stringify({ expression: '{fld1} * 2', dbGenerated: true }),
        },
      ];

      const context = service.createExpansionContext(fields);
      const result = service.shouldExpandFormula(fields[1], context);

      expect(result).toBe(true);
    });

    it('should return false for formula field not referencing other formula fields', () => {
      const fields: IFieldForExpansion[] = [
        {
          id: 'fld1',
          type: FieldType.Number,
          dbFieldName: 'field1',
          options: null,
        },
        {
          id: 'fld2',
          type: FieldType.Formula,
          dbFieldName: 'field2',
          options: JSON.stringify({ expression: '{fld1} * 2', dbGenerated: true }),
        },
      ];

      const context = service.createExpansionContext(fields);
      const result = service.shouldExpandFormula(fields[1], context);

      expect(result).toBe(false);
    });

    it('should return false for formula field with dbGenerated=false', () => {
      const fields: IFieldForExpansion[] = [
        {
          id: 'fld1',
          type: FieldType.Formula,
          dbFieldName: 'field1',
          options: JSON.stringify({ expression: '1 + 1', dbGenerated: true }),
        },
        {
          id: 'fld2',
          type: FieldType.Formula,
          dbFieldName: 'field2',
          options: JSON.stringify({ expression: '{fld1} * 2', dbGenerated: false }),
        },
      ];

      const context = service.createExpansionContext(fields);
      const result = service.shouldExpandFormula(fields[1], context);

      expect(result).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should handle invalid JSON in field options', () => {
      const fields: IFieldForExpansion[] = [
        {
          id: 'fld1',
          type: FieldType.Formula,
          dbFieldName: 'field1',
          options: 'invalid json',
        },
      ];

      const context = service.createExpansionContext(fields);

      expect(() => {
        service.expandFormulaExpression('{fld1} * 2', context);
      }).toThrow('Failed to parse options for field fld1');
    });

    it('should handle missing field references', () => {
      const fields: IFieldForExpansion[] = [];
      const context = service.createExpansionContext(fields);

      expect(() => {
        service.expandFormulaExpression('{nonexistent} * 2', context);
      }).toThrow('Referenced field not found: nonexistent');
    });
  });
});
