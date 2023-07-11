/* eslint-disable @typescript-eslint/no-explicit-any */
import { plainToInstance } from 'class-transformer';
import { FieldType, DbFieldType, CellValueType } from '../constant';
import { FieldCore } from '../field';
import { SingleLineTextFieldCore } from './single-line-text.field';

describe('SingleLineTextFieldCore', () => {
  let field: SingleLineTextFieldCore;
  let multipleLookupField: SingleLineTextFieldCore;

  const json = {
    id: 'test',
    name: 'Test Single Line Text Field',
    description: 'A test Single Line Text field',
    notNull: true,
    unique: true,
    isPrimary: true,
    columnMeta: {
      index: 0,
      columnIndex: 0,
    },
    type: FieldType.SingleLineText,
    dbFieldType: DbFieldType.Text,
    options: {},
    cellValueType: CellValueType.String,
    isComputed: false,
  };

  beforeEach(() => {
    field = plainToInstance(SingleLineTextFieldCore, json);
    multipleLookupField = plainToInstance(SingleLineTextFieldCore, {
      ...json,
      isMultipleCellValue: true,
      isLookup: true,
      isComputed: true,
    });
  });

  it('should extend parent class', () => {
    expect(field).toBeInstanceOf(FieldCore);
    expect(field).toBeInstanceOf(SingleLineTextFieldCore);
  });

  it('should convert cellValue to string', () => {
    expect(field.cellValue2String('text')).toBe('text');
    expect(field.cellValue2String(null as any)).toBe('');
    expect(multipleLookupField.cellValue2String(['text'])).toBe('text');
    expect(multipleLookupField.cellValue2String(['text', 'text2'])).toBe('text, text2');
  });

  it('should convert string to cellValue', () => {
    expect(field.convertStringToCellValue('text')).toBe('text');
    expect(field.convertStringToCellValue(null as any)).toBeNull();

    expect(multipleLookupField.convertStringToCellValue('1.234')).toBeNull();
  });

  it('should repair invalid value', () => {
    expect(field.repair(123)).toBe('123');

    expect(multipleLookupField.repair('1.234')).toBeNull();
  });

  it('should validate value', () => {
    expect(field.validateCellValue('1.234').success).toBe(true);
    expect(field.validateCellValue(1.234).success).toBe(false);

    expect(multipleLookupField.validateCellValue(['1.234']).success).toBe(true);
    expect(multipleLookupField.validateCellValue([1.234]).success).toBe(false);
  });

  describe('validateOptions', () => {
    it('should return success if options are valid', () => {
      const result = field.validateOptions();
      expect(result.success).toBe(true);
    });

    it('should return failure if options are invalid', () => {
      const field = plainToInstance(SingleLineTextFieldCore, {
        ...json,
        options: null,
      });
      const result = field.validateOptions();
      expect(result.success).toBe(false);
    });
  });
});
