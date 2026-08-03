/* eslint-disable @typescript-eslint/no-explicit-any */
import { plainToInstance } from 'class-transformer';
import { FieldType, DbFieldType, CellValueType } from '../constant';
import { FieldCore } from '../field';
import { CheckboxFieldCore } from './checkbox.field';

describe('CheckboxFieldCore', () => {
  let field: CheckboxFieldCore;
  let multipleLookupField: CheckboxFieldCore;

  const json = {
    id: 'test',
    name: 'Test Number Field',
    description: 'A test number field',
    columnMeta: {
      index: 0,
      columnIndex: 0,
    },
    type: FieldType.Checkbox,
    dbFieldType: DbFieldType.Integer,
    options: {},
    cellValueType: CellValueType.Boolean,
    isComputed: false,
  };

  beforeEach(() => {
    field = plainToInstance(CheckboxFieldCore, json);
    multipleLookupField = plainToInstance(CheckboxFieldCore, {
      ...json,
      isMultipleCellValue: true,
      isLookup: true,
      isComputed: true,
    });
  });

  it('should extend parent class', () => {
    expect(field).toBeInstanceOf(FieldCore);
    expect(field).toBeInstanceOf(CheckboxFieldCore);
  });

  it('should convert cellValue to string', () => {
    expect(field.cellValue2String(true)).toBe('true');
    expect(field.cellValue2String(null as any)).toBe('');
    expect(multipleLookupField.cellValue2String([true])).toBe('true');
    expect(multipleLookupField.cellValue2String([true, true])).toBe('true, true');
  });

  it('should convert string to cellValue', () => {
    expect(field.convertStringToCellValue('1.234')).toBe(true);
    expect(field.convertStringToCellValue(null as any)).toBeNull();

    expect(multipleLookupField.convertStringToCellValue('1.234')).toBeNull();
  });

  it('should repair invalid value', () => {
    expect(field.repair('1.234')).toBe(true);
    expect(field.repair(false)).toBeNull();
    expect(field.repair('false')).toBeNull();
    expect(field.repair('true')).toBe(true);
    expect(field.repair('True')).toBe(true);
  });

  it('should validate value', () => {
    expect(field.validateCellValue(true).success).toBeTruthy();
    expect(field.validateCellValue(false).success).toBeTruthy();
    expect(field.validateCellValue(1).success).toBeFalsy();
    expect(field.validateCellValue('1').success).toBeFalsy();

    expect(multipleLookupField.validateCellValue([true]).success).toBeTruthy();
    expect(multipleLookupField.validateCellValue([false]).success).toBeFalsy();
  });

  describe('validateOptions', () => {
    it('should return success if options are valid', () => {
      const result = field.validateOptions();
      expect(result.success).toBe(true);
    });

    it('should return failure if options are invalid', () => {
      const field = plainToInstance(CheckboxFieldCore, {
        ...json,
        options: null,
      });
      const result = field.validateOptions();
      expect(result.success).toBe(false);
    });
  });
});
