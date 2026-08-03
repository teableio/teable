import { plainToInstance } from 'class-transformer';
import { CellValueType, DbFieldType, FieldType } from '../constant';
import { AutoNumberFieldCore } from './auto-number.field';

describe('AutoNumberFieldCore', () => {
  const autoNumberJson = {
    id: 'fld123',
    name: 'Auto number',
    description: 'A test auto number field',
    notNull: false,
    unique: false,
    isPrimary: false,
    columnMeta: {
      index: 0,
      columnIndex: 0,
    },
    type: FieldType.AutoNumber,
    options: {},
    dbFieldType: DbFieldType.Integer,
    cellValueType: CellValueType.Number,
    isComputed: true,
  };

  const autoNumberField = plainToInstance(AutoNumberFieldCore, { ...autoNumberJson });

  describe('basic function', () => {
    it('should convert cellValue to string', () => {
      expect(autoNumberField.cellValue2String(1)).toBe('1');
    });

    it('should validate cellValue', () => {
      expect(autoNumberField.validateCellValue(1).success).toBe(true);
      expect(autoNumberField.validateCellValue('1').success).toBe(false);
    });

    it('should convert string to cellValue', () => {
      expect(autoNumberField.convertStringToCellValue('1')).toBe(null);
    });

    it('should repair invalid value', () => {
      expect(autoNumberField.repair(true)).toBe(null);
    });
  });

  describe('validateOptions', () => {
    it('should return success if options are valid', () => {
      expect(autoNumberField.validateOptions().success).toBeTruthy();
    });

    it('should get default options', () => {
      expect(AutoNumberFieldCore.defaultOptions()).toEqual({});
    });
  });
});
