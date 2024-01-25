import { plainToInstance } from 'class-transformer';
import { Colors } from '../colors';
import { FieldType, DbFieldType, CellValueType } from '../constant';
import { FieldCore } from '../field';
import { convertFieldRoSchema } from '../field.schema';
import { RatingFieldCore, RatingIcon } from './rating.field';

describe('RatingFieldCore', () => {
  let field: RatingFieldCore;
  let multipleLookupField: RatingFieldCore;

  const json = {
    id: 'test',
    name: 'Test Rating Field',
    description: 'A test rating field',
    type: FieldType.Rating,
    dbFieldType: DbFieldType.Real,
    options: {
      icon: RatingIcon.Star,
      color: Colors.YellowBright,
      max: 5,
    },
    cellValueType: CellValueType.Number,
    isComputed: false,
  };

  beforeEach(() => {
    field = plainToInstance(RatingFieldCore, json);
    multipleLookupField = plainToInstance(RatingFieldCore, {
      ...json,
      isMultipleCellValue: true,
      isLookup: true,
      isComputed: true,
    });
  });

  it('should extend parent class', () => {
    expect(field).toBeInstanceOf(FieldCore);
    expect(field).toBeInstanceOf(RatingFieldCore);
  });

  it('should convert cellValue to string', () => {
    expect(field.cellValue2String(1)).toBe('1');
    expect(field.cellValue2String(null)).toBe('');
    expect(multipleLookupField.cellValue2String([1])).toBe('1');
    expect(multipleLookupField.cellValue2String([1, 2])).toBe('1, 2');
  });

  it('should convert string to cellValue', () => {
    expect(field.convertStringToCellValue('10')).toBe(5);
    expect(field.convertStringToCellValue('2.4')).toBe(2);
    expect(field.convertStringToCellValue('2.5')).toBe(3);
    expect(field.convertStringToCellValue('abc')).toBeNull();

    expect(multipleLookupField.convertStringToCellValue('1.234')).toBeNull();
  });

  it('should repair invalid value', () => {
    expect(field.repair(1.4)).toBe(1);
    expect(field.repair(1.5)).toBe(2);
    expect(field.repair(8)).toBe(5);
    expect(field.repair('1.4')).toBe(1);
    expect(field.repair('1.5')).toBe(2);
    expect(field.repair('8')).toBe(5);
    expect(field.repair('abc')).toBeNull();
  });

  it('should validate value', () => {
    expect(field.validateCellValue(5).success).toBeTruthy();
    expect(field.validateCellValue(10).success).toBeFalsy();
    expect(field.validateCellValue(1.234).success).toBeFalsy();
    expect(field.validateCellValue('5').success).toBeFalsy();

    expect(multipleLookupField.validateCellValue([5]).success).toBeTruthy();
    expect(multipleLookupField.validateCellValue([10]).success).toBeFalsy();
    expect(multipleLookupField.validateCellValue(['5']).success).toBeFalsy();
  });

  describe('validateOptions', () => {
    it('should return success if options are valid', () => {
      expect(convertFieldRoSchema.safeParse(json).success).toBe(true);
    });

    it('should return failure if options are invalid', () => {
      expect(
        plainToInstance(RatingFieldCore, {
          ...json,
          options: {
            ...json.options,
            max: 0,
          },
        }).validateOptions().success
      ).toBeFalsy();

      expect(
        plainToInstance(RatingFieldCore, {
          ...json,
          options: {
            ...json.options,
            max: 15,
          },
        }).validateOptions().success
      ).toBeFalsy();

      expect(
        plainToInstance(RatingFieldCore, {
          ...json,
          options: {
            ...json.options,
            color: Colors.Cyan,
          },
        }).validateOptions().success
      ).toBeFalsy();

      expect(
        plainToInstance(RatingFieldCore, {
          ...json,
          options: {
            ...json.options,
            icon: 'test-icon',
          },
        }).validateOptions().success
      ).toBeFalsy();
    });
  });
});
