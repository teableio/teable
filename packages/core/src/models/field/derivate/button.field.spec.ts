/* eslint-disable @typescript-eslint/no-explicit-any */
import { plainToInstance } from 'class-transformer';
import { Colors } from '../colors';
import { FieldType, DbFieldType, CellValueType } from '../constant';
import { FieldCore } from '../field';
import { ButtonFieldCore } from './button.field';

describe('ButtonFieldCore', () => {
  let field: ButtonFieldCore;
  let multipleLookupField: ButtonFieldCore;

  const json = {
    id: 'test',
    name: 'Test Button Field',
    description: 'A test Button field',
    type: FieldType.Button,
    dbFieldType: DbFieldType.Json,
    options: {
      label: 'Button',
      color: Colors.Teal,
    },
    cellValueType: CellValueType.String,
    isComputed: false,
  };

  beforeEach(() => {
    field = plainToInstance(ButtonFieldCore, json);
    multipleLookupField = plainToInstance(ButtonFieldCore, {
      ...json,
      isMultipleCellValue: true,
      isLookup: true,
      isComputed: true,
    });
  });

  it('should extend parent class', () => {
    expect(field).toBeInstanceOf(FieldCore);
    expect(field).toBeInstanceOf(ButtonFieldCore);
  });

  it('should convert cellValue to string', () => {
    expect(field.cellValue2String('text')).toBe('');
    expect(field.cellValue2String(null as any)).toBe('');
    expect(multipleLookupField.cellValue2String(['text'])).toBe('');
    expect(multipleLookupField.cellValue2String(['text', 'text2'])).toBe('');
  });

  it('should convert string to cellValue', () => {
    expect(field.convertStringToCellValue('text')).toBeNull();
    expect(field.convertStringToCellValue('wrap\ntext')).toBeNull();
    expect(field.convertStringToCellValue(null as any)).toBeNull();

    expect(multipleLookupField.convertStringToCellValue('1.234')).toBeNull();
  });

  it('should repair invalid value', () => {
    expect(field.repair(123)).toBeNull();

    expect(multipleLookupField.repair('1.234')).toBeNull();
  });

  it('should validate value', () => {
    expect(field.validateCellValue('1.234').success).toBe(false);
    expect(field.validateCellValue(1.234).success).toBe(false);
    expect(field.validateCellValue(null).success).toBe(true);

    expect(multipleLookupField.validateCellValue(['1.234']).success).toBe(false);
    expect(multipleLookupField.validateCellValue([1.234]).success).toBe(false);
  });

  describe('validateOptions', () => {
    it('should return success if options are plain object', () => {
      const field = plainToInstance(ButtonFieldCore, {
        ...json,
        options: {
          label: 'Button123',
          color: Colors.Blue,
        },
      });
      const result = field.validateOptions();
      expect(result.success).toBe(true);
    });

    it('should return failure if options are invalid', () => {
      const field = plainToInstance(ButtonFieldCore, {
        ...json,
        options: null,
      });
      const result = field.validateOptions();
      expect(result.success).toBe(false);
    });

    it('should get default options', () => {
      expect(ButtonFieldCore.defaultOptions()).toEqual({
        label: 'Button',
        color: Colors.Teal,
      });
    });
  });
});
