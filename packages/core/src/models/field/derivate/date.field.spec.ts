/* eslint-disable @typescript-eslint/no-explicit-any */
import { plainToInstance } from 'class-transformer';
import { FieldType, DbFieldType, CellValueType } from '../constant';
import { FieldCore } from '../field';
import type { DateFieldOptions } from './date.field';
import { DateFieldCore, DateFormatting, TimeFormatting, DEFAULT_TIME_ZONE } from './date.field';

describe('DateFieldCore', () => {
  let field: DateFieldCore;

  beforeEach(() => {
    const json = {
      id: 'test',
      name: 'Test Date Field',
      description: 'A test date field',
      notNull: true,
      unique: true,
      isPrimary: true,
      columnMeta: {
        index: 0,
        columnIndex: 0,
      },
      type: FieldType.Date,
      dbFieldType: DbFieldType.DateTime,
      options: {
        dateFormatting: DateFormatting.YMDWithSlash,
        timeFormatting: TimeFormatting.Hour24,
        timeZone: DEFAULT_TIME_ZONE,
        autoFill: true,
      },
      defaultValue: 0,
      cellValueType: CellValueType.DateTime,
      isComputed: false,
    };

    field = plainToInstance(DateFieldCore, json);
  });

  it('should extend parent class', () => {
    expect(field).toBeInstanceOf(FieldCore);
    expect(field).toBeInstanceOf(DateFieldCore);
  });

  it('should have correct properties', () => {
    expect(field.type).toBe(FieldType.Date);
    expect(field.isComputed).toBe(false);
    expect(field.dbFieldType).toBe(DbFieldType.DateTime);
    expect(field.cellValueType).toBe(CellValueType.DateTime);
  });

  it('should convert cellValue to string', () => {
    expect(field.cellValue2String(null as any)).toBe('');
    expect(field.cellValue2String('2023-06-19T06:50:48.017Z')).toBe('2023/06/19 14:50');
  });

  it('should convert string to cellValue', () => {
    expect(field.convertStringToCellValue('2023/06/19 14:50')).toBe('2023-06-19T06:50:00.000Z');
    expect(field.convertStringToCellValue('abc')).toBeNull();
  });

  it('should repair invalid value', () => {
    expect(() => field.repair(1687158022191)).not.toThrow();
    expect(() => field.repair(true)).toThrowError('invalid value: true for field: Test Date Field');
  });

  describe('validateOptions', () => {
    it('should return success if options are valid', () => {
      const options: DateFieldOptions = {
        dateFormatting: DateFormatting.Y,
        timeFormatting: TimeFormatting.Hour24,
        timeZone: DEFAULT_TIME_ZONE,
        autoFill: true,
      };
      const field = new DateFieldCore();
      field.options = options;
      const result = field.validateOptions();
      expect(result.success).toBe(true);
    });

    it('should return failure if options are invalid', () => {
      const optionsList: DateFieldOptions[] = [
        {
          dateFormatting: 'abc' as unknown as DateFormatting,
          timeFormatting: TimeFormatting.Hour24,
          timeZone: DEFAULT_TIME_ZONE,
          autoFill: true,
        },
        {
          dateFormatting: DateFormatting.DMY,
          timeFormatting: 'abc' as unknown as TimeFormatting,
          timeZone: DEFAULT_TIME_ZONE,
          autoFill: false,
        },
        {
          dateFormatting: DateFormatting.Y,
          timeFormatting: TimeFormatting.Hour24,
          timeZone: 123 as unknown as string,
          autoFill: true,
        },
        {
          dateFormatting: DateFormatting.Y,
          timeFormatting: TimeFormatting.Hour24,
          timeZone: DEFAULT_TIME_ZONE,
          autoFill: 'abc' as unknown as boolean,
        },
      ];

      optionsList.forEach((options) => {
        const field = new DateFieldCore();
        field.options = options;
        const result = field.validateOptions();
        expect(result.success).toBe(false);
      });
    });
  });

  describe('validateDefaultValue', () => {
    it('should return success if default value is null', () => {
      const field = new DateFieldCore();
      field.defaultValue = null;
      const result = field.validateDefaultValue();
      expect(result.success).toBe(true);
    });

    it('should return success if default value is a string', () => {
      const field = new DateFieldCore();
      field.defaultValue = '2023-06-19T06:50:00.000Z';
      const result = field.validateDefaultValue();
      expect(result.success).toBe(true);
    });

    it('should return success if default value is a number', () => {
      const field = new DateFieldCore();
      field.defaultValue = 1687158022191;
      const result = field.validateDefaultValue();
      expect(result.success).toBe(true);
    });

    it('should return failure if default value is not a number or string', () => {
      const field = new DateFieldCore();
      field.defaultValue = true as any;
      const result = field.validateDefaultValue();
      expect(result.success).toBe(false);
    });
  });
});
