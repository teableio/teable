/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { plainToInstance } from 'class-transformer';
import { FieldType, DbFieldType, CellValueType } from '../constant';
import { FieldCore } from '../field';
import type { ITimeZoneString } from '../formatting';
import { DateFormattingPreset, defaultDatetimeFormatting, TimeFormatting } from '../formatting';
import type { IDateFieldOptions } from './date.field';
import { DateFieldCore } from './date.field';

// eslint-disable-next-line @typescript-eslint/naming-convention
const DEFAULT_TIME_ZONE = 'utc';

describe('DateFieldCore', () => {
  let field: DateFieldCore;
  let lookupField: DateFieldCore;
  const json = {
    id: 'test',
    name: 'Test Date Field',
    description: 'A test date field',
    columnMeta: {
      index: 0,
      columnIndex: 0,
    },
    type: FieldType.Date,
    dbFieldType: DbFieldType.DateTime,
    options: {
      formatting: {
        date: DateFormattingPreset.Asian,
        time: TimeFormatting.Hour24,
        timeZone: DEFAULT_TIME_ZONE,
      },
      defaultValue: 'now',
    },
    cellValueType: CellValueType.DateTime,
    isComputed: false,
  };
  const lookupJson = {
    isLookup: true,
    isComputed: true,
    isMultipleCellValue: true,
    dbFieldType: DbFieldType.Json,
  };

  beforeEach(() => {
    field = plainToInstance(DateFieldCore, json);
    lookupField = plainToInstance(DateFieldCore, {
      ...json,
      ...lookupJson,
    });
  });

  it('should extend parent class', () => {
    expect(field).toBeInstanceOf(FieldCore);
    expect(field).toBeInstanceOf(DateFieldCore);
  });

  it('should convert cellValue to string', () => {
    expect(field.cellValue2String(null as any)).toBe('');
    expect(field.cellValue2String('2023-06-19T06:50:48.017Z')).toBe('2023/06/19 06:50');
    expect(lookupField.cellValue2String(null as any)).toBe('');
    expect(lookupField.cellValue2String(['2023-06-19T06:50:48.017Z'])).toBe('2023/06/19 06:50');
    expect(
      lookupField.cellValue2String(['2023-06-19T06:50:48.017Z', '2023-06-19T06:50:48.017Z'])
    ).toBe('2023/06/19 06:50, 2023/06/19 06:50');
  });

  it('should convert string to cellValue', () => {
    expect(field.convertStringToCellValue('2023/06/19 06:50')).toBe('2023-06-19T06:50:00.000Z');
    expect(field.convertStringToCellValue('abc')).toBeNull();
    expect(lookupField.convertStringToCellValue('2023/06/19 06:50')).toBeNull();
    expect(lookupField.convertStringToCellValue('abc')).toBeNull();
    expect(field.convertStringToCellValue('2023/1/13 06:50')).toBe('2023-01-13T06:50:00.000Z');

    // european and us date format
    const europeanField = plainToInstance(DateFieldCore, {
      ...json,
      options: {
        formatting: {
          date: DateFormattingPreset.European,
          time: TimeFormatting.Hour24,
          timeZone: DEFAULT_TIME_ZONE,
        },
        defaultValue: 'now',
      },
    });
    expect(europeanField.convertStringToCellValue('5/1/2024')).toBe('2024-01-05T00:00:00.000Z');
    const usField = plainToInstance(DateFieldCore, {
      ...json,
      options: {
        formatting: {
          date: DateFormattingPreset.US,
          time: TimeFormatting.Hour24,
          timeZone: DEFAULT_TIME_ZONE,
        },
        defaultValue: 'now',
      },
    });
    expect(usField.convertStringToCellValue('5/1/2024 06:50')).toBe('2024-05-01T06:50:00.000Z');
  });

  it('should repair invalid value', () => {
    expect(field.repair(1687158022191)).toBe('2023-06-19T07:00:22.191Z');
    expect(field.repair('xxx')).toBe(null);
    expect(lookupField.repair(1687158022191)).toBe(null);
    expect(lookupField.repair('xxx')).toBe(null);
  });

  it('should valid cellValue', () => {
    const date = new Date();
    const cellValue = date.toISOString();
    const lookupFieldOne = plainToInstance(DateFieldCore, {
      ...json,
      lookupJson,
      isMultipleCellValue: false,
    });
    expect(field.validateCellValue(cellValue).success).toBe(true);
    expect(field.validateCellValue(date.getTime()).success).toBe(false);
    expect(field.validateCellValue('xxx').success).toBe(false);

    expect(lookupField.validateCellValue([cellValue]).success).toBe(true);
    expect(lookupField.validateCellValue(cellValue).success).toBe(false);
    expect(lookupField.validateCellValue([{ id: 'actxxx' }]).success).toBe(false);

    expect(lookupFieldOne.validateCellValue(cellValue).success).toBe(true);
  });

  describe('validateOptions', () => {
    it('should return success if options are valid', () => {
      const options: IDateFieldOptions = {
        formatting: {
          date: DateFormattingPreset.Y,
          time: TimeFormatting.Hour24,
          timeZone: DEFAULT_TIME_ZONE,
        },
        defaultValue: 'now',
      };
      const field = plainToInstance(DateFieldCore, {
        ...json,
        options,
      });
      expect(field.validateOptions().success).toBe(true);
    });

    it('should return failure if options are invalid', () => {
      const optionsList: IDateFieldOptions[] = [
        {
          formatting: {
            date: DateFormattingPreset.ISO,
            time: 'abc' as any,
            timeZone: DEFAULT_TIME_ZONE,
          },
        },
        {
          formatting: {
            date: DateFormattingPreset.Y,
            time: TimeFormatting.Hour24,
            timeZone: 123 as unknown as ITimeZoneString,
          },
          defaultValue: 'now',
        },
        {
          formatting: {
            date: DateFormattingPreset.Y,
            time: TimeFormatting.Hour24,
            timeZone: DEFAULT_TIME_ZONE,
          },
          defaultValue: 'abc' as any,
        },
      ];

      optionsList.forEach((options) => {
        const field = plainToInstance(DateFieldCore, {
          ...json,
          options,
        });
        expect(field.validateOptions().success).toBe(false);
      });
    });

    it('should get default options', () => {
      expect(DateFieldCore.defaultOptions()).toEqual({
        formatting: defaultDatetimeFormatting,
      });
    });
  });
});
