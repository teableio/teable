/* eslint-disable @typescript-eslint/no-explicit-any */
import { plainToInstance } from 'class-transformer';
import { FieldType, DbFieldType, CellValueType } from '../constant';
import { FieldCore } from '../field';
import type { NumberFieldOptions } from './number.field';
import { NumberFieldCore } from './number.field';

describe('NumberFieldCore', () => {
  let field: NumberFieldCore;

  beforeEach(() => {
    const json = {
      id: 'test',
      name: 'Test Number Field',
      description: 'A test number field',
      notNull: true,
      unique: true,
      isPrimary: true,
      columnMeta: {
        index: 0,
        columnIndex: 0,
      },
      type: FieldType.Number,
      dbFieldType: DbFieldType.Real,
      options: {
        precision: 2,
      },
      defaultValue: 0,
      cellValueType: CellValueType.Number,
      isComputed: false,
    };

    field = plainToInstance(NumberFieldCore, json);
  });

  it('should extend parent class', () => {
    expect(field).toBeInstanceOf(FieldCore);
    expect(field).toBeInstanceOf(NumberFieldCore);
  });

  it('should have correct properties', () => {
    expect(field.type).toBe(FieldType.Number);
    expect(field.isComputed).toBe(false);
    expect(field.dbFieldType).toBe(DbFieldType.Real);
    expect(field.cellValueType).toBe(CellValueType.Number);
  });

  it('should convert cellValue to string', () => {
    expect(field.cellValue2String(1.234)).toBe('1.23');
    expect(field.cellValue2String(null as any)).toBe('');
  });

  it('should convert string to cellValue', () => {
    expect(field.convertStringToCellValue('1.234')).toBe(1.234);
    expect(field.convertStringToCellValue('abc')).toBeNull();
  });

  it('should repair invalid value', () => {
    expect(() => field.repair('1.234')).not.toThrow();
    expect(() => field.repair(null)).toThrowError(
      'invalid value: null for field: Test Number Field'
    );
  });

  describe('validateOptions', () => {
    it('should return success if options are valid', () => {
      const options: NumberFieldOptions = {
        precision: 2,
      };
      const field = new NumberFieldCore();
      field.options = options;
      const result = field.validateOptions();
      expect(result.success).toBe(true);
    });

    it('should return failure if options are invalid', () => {
      const options: NumberFieldOptions = {
        precision: -1, // invalid precision value
      };
      const field = new NumberFieldCore();
      field.options = options;
      const result = field.validateOptions();
      expect(result.success).toBe(false);
    });
  });

  describe('validateDefaultValue', () => {
    it('should return success if default value is null', () => {
      const field = new NumberFieldCore();
      field.defaultValue = null as any;
      const result = field.validateDefaultValue();
      expect(result.success).toBe(true);
    });

    it('should return success if default value is a number', () => {
      const field = new NumberFieldCore();
      field.defaultValue = 123.45;
      const result = field.validateDefaultValue();
      expect(result.success).toBe(true);
    });

    it('should return failure if default value is not a number', () => {
      const field = new NumberFieldCore();
      field.defaultValue = 'not a number' as any;
      const result = field.validateDefaultValue();
      expect(result.success).toBe(false);
    });
  });
});
