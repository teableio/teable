/* eslint-disable @typescript-eslint/no-explicit-any */
import { plainToInstance } from 'class-transformer';
import { FieldType, DbFieldType, CellValueType } from '../constant';
import { FieldCore } from '../field';
import type { INumberFieldOptions } from './number.field';
import { NumberFieldCore } from './number.field';

describe('NumberFieldCore', () => {
  let field: NumberFieldCore;
  let multipleLookupField: NumberFieldCore;

  const json = {
    id: 'test',
    name: 'Test Number Field',
    description: 'A test number field',
    isPrimary: true,
    columnMeta: {},
    type: FieldType.Number,
    dbFieldType: DbFieldType.Real,
    options: {
      formatting: { precision: 2 },
    },
    cellValueType: CellValueType.Number,
    isComputed: false,
  };

  beforeEach(() => {
    field = plainToInstance(NumberFieldCore, json);
    multipleLookupField = plainToInstance(NumberFieldCore, {
      ...json,
      isMultipleCellValue: true,
      isLookup: true,
      isComputed: true,
    });
  });

  it('should extend parent class', () => {
    expect(field).toBeInstanceOf(FieldCore);
    expect(field).toBeInstanceOf(NumberFieldCore);
  });

  it('should convert cellValue to string', () => {
    expect(field.cellValue2String(1.234)).toBe('1.23');
    expect(field.cellValue2String(null as any)).toBe('');
    expect(multipleLookupField.cellValue2String([1.234])).toBe('1.23');
    expect(multipleLookupField.cellValue2String([1.234, 2.345])).toBe('1.23, 2.35');
  });

  it('should convert string to cellValue', () => {
    expect(field.convertStringToCellValue('1.234')).toBe(1.234);
    expect(field.convertStringToCellValue('abc')).toBeNull();

    expect(multipleLookupField.convertStringToCellValue('1.234')).toBeNull();
  });

  it('should repair invalid value', () => {
    expect(field.repair('1.234')).toBe(1.234);
    expect(field.repair('abc')).toBeNull();
  });

  it('should validate value', () => {
    expect(field.validateCellValue(1.234).success).toBeTruthy();
    expect(field.validateCellValue('1.234').success).toBeFalsy();

    expect(multipleLookupField.validateCellValue([1.234]).success).toBeTruthy();
    expect(multipleLookupField.validateCellValue(['1.234']).success).toBeFalsy();
  });

  describe('validateOptions', () => {
    it('should return success if options are valid', () => {
      const options: INumberFieldOptions = {
        formatting: { precision: 2 },
      };
      const field = plainToInstance(NumberFieldCore, {
        ...json,
        ...options,
      });
      const result = field.validateOptions();
      expect(result.success).toBe(true);
    });

    it('should return failure if options are invalid', () => {
      const options: INumberFieldOptions = {
        formatting: { precision: -1 }, // invalid precision value
      } as any;
      const field = plainToInstance(NumberFieldCore, {
        ...json,
        options,
      });
      const result = field.validateOptions();
      expect(result.success).toBe(false);
    });
  });
});
