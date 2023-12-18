import { plainToInstance } from 'class-transformer';
import { CellValueType, DbFieldType, FieldType } from '../constant';
import { DateFormattingPreset, defaultDatetimeFormatting } from '../formatting';
import { LastModifiedTimeFieldCore } from './last-modified-time.field';

describe('LastModifiedTimeFieldCore', () => {
  const lastModifiedTimeJson = {
    id: 'fld123',
    name: 'Last modified time',
    description: 'A test last modified time field',
    notNull: false,
    unique: false,
    isPrimary: false,
    columnMeta: {
      index: 0,
      columnIndex: 0,
    },
    type: FieldType.LastModifiedTime,
    options: {
      formatting: defaultDatetimeFormatting,
    },
    dbFieldType: DbFieldType.DateTime,
    cellValueType: CellValueType.DateTime,
    isComputed: true,
  };

  const lastModifiedTimeField = plainToInstance(LastModifiedTimeFieldCore, {
    ...lastModifiedTimeJson,
  });

  describe('basic function', () => {
    it('should convert cellValue to string', () => {
      expect(lastModifiedTimeField.cellValue2String('2023-11-28T06:50:48.017Z')).toBe('2023-11-28');
    });

    it('should validate cellValue', () => {
      expect(lastModifiedTimeField.validateCellValue('date').success).toBe(false);
      expect(lastModifiedTimeField.validateCellValue('2023-11-28T06:50:48.017Z').success).toBe(
        true
      );
    });

    it('should convert string to cellValue', () => {
      expect(lastModifiedTimeField.convertStringToCellValue('1')).toBe(null);
    });

    it('should repair invalid value', () => {
      expect(lastModifiedTimeField.repair(1)).toBe(null);
    });
  });

  describe('validateOptions', () => {
    it('should return success if options are valid', () => {
      expect(lastModifiedTimeField.validateOptions().success).toBeTruthy();
    });

    it('should return failure if options are invalid', () => {
      expect(
        plainToInstance(LastModifiedTimeFieldCore, {
          ...lastModifiedTimeJson,
          options: {
            ...lastModifiedTimeJson.options,
            formatting: {
              date: DateFormattingPreset.ISO,
              time: 'abc',
              timeZone: 'utc',
            },
          },
        }).validateOptions().success
      ).toBeFalsy();
    });

    it('should get default options', () => {
      expect(LastModifiedTimeFieldCore.defaultOptions()).toEqual({
        formatting: defaultDatetimeFormatting,
      });
    });
  });
});
