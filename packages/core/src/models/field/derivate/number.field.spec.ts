/* eslint-disable @typescript-eslint/no-explicit-any */
import { plainToInstance } from 'class-transformer';
import { Colors } from '../colors';
import { FieldType, DbFieldType, CellValueType } from '../constant';
import { FieldCore } from '../field';
import { convertFieldRoSchema } from '../field.schema';
import { NumberFormattingType } from '../formatting';
import { MultiNumberDisplayType, SingleNumberDisplayType } from '../show-as';
import { NumberFieldCore } from './number.field';

describe('NumberFieldCore', () => {
  let field: NumberFieldCore;
  let multipleLookupField: NumberFieldCore;

  const singleNumberShowAsProps = {
    type: SingleNumberDisplayType.Ring,
    color: Colors.TealBright,
    showValue: false,
    maxValue: 100,
  };

  const multiNumberShowAsProps = {
    type: MultiNumberDisplayType.Line,
    color: Colors.TealBright,
  };

  const json = {
    id: 'test',
    name: 'Test Number Field',
    description: 'A test number field',
    type: FieldType.Number,
    dbFieldType: DbFieldType.Real,
    options: {
      formatting: { type: NumberFormattingType.Decimal, precision: 2 },
      showAs: singleNumberShowAsProps,
    },
    cellValueType: CellValueType.Number,
    isComputed: false,
  };

  const invalidShowAsTestCases = [
    {
      ...json,
      options: {
        ...json.options,
        showAs: singleNumberShowAsProps,
      },
      isMultipleCellValue: true,
      isComputed: true,
      isLookup: true,
    },
    {
      ...json,
      options: {
        ...json.options,
        showAs: multiNumberShowAsProps,
      },
    },
  ];

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
      expect(
        convertFieldRoSchema.safeParse({
          ...json,
          options: {
            ...json.options,
          },
        }).success
      ).toBe(true);
    });

    it('should return failure if options are invalid', () => {
      expect(
        plainToInstance(NumberFieldCore, {
          ...json,
          options: {
            ...json.options,
            formatting: { type: NumberFormattingType.Decimal, precision: -1 }, // invalid precision value
          },
        }).validateOptions().success
      ).toBe(false);

      expect(
        plainToInstance(NumberFieldCore, {
          ...json,
          options: {
            ...json.options,
            formatting: { type: 'ABC', precision: 2 }, // invalid type value
          },
        }).validateOptions().success
      ).toBe(false);

      invalidShowAsTestCases.forEach((field) => {
        expect(plainToInstance(NumberFieldCore, field).validateOptions().success).toBeFalsy();
      });
    });
  });
});
