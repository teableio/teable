/* eslint-disable @typescript-eslint/no-explicit-any */
import { plainToInstance } from 'class-transformer';
import { Colors } from '../colors';
import { CellValueType, DbFieldType, FieldType } from '../constant';
import { FieldCore } from '../field';
import type { IFieldVo } from '../field.schema';
import { MultipleSelectFieldCore } from './multiple-select.field';

describe('MultipleSelectFieldCore', () => {
  let field: MultipleSelectFieldCore;
  let lookupField: MultipleSelectFieldCore;
  const json: IFieldVo = {
    id: 'fldtestxxxxxx',
    dbFieldName: 'fldtestxxxxxx',
    name: 'Test SingleSelect Field',
    description: 'A test SingleSelect field',
    options: {
      choices: [
        { id: 'cho1', name: 'Option 1', color: Colors.Blue },
        { id: 'cho2', name: 'Option 2', color: Colors.Red },
      ],
    },
    type: FieldType.SingleSelect,
    dbFieldType: DbFieldType.Json,
    cellValueType: CellValueType.String,
    isMultipleCellValue: true,
    isComputed: false,
  };

  const lookupJson = {
    isLookup: true,
    isComputed: true,
  };

  beforeEach(() => {
    field = plainToInstance(MultipleSelectFieldCore, json);
    lookupField = plainToInstance(MultipleSelectFieldCore, {
      ...json,
      ...lookupJson,
    });
  });

  it('should extend parent class', () => {
    expect(field).toBeInstanceOf(FieldCore);
    expect(field).toBeInstanceOf(MultipleSelectFieldCore);
  });

  it('should convert cellValue to string', () => {
    expect(field.cellValue2String(null as any)).toBe('');
    expect(field.cellValue2String(['Option 1'])).toEqual('Option 1');
    expect(field.cellValue2String(['Option 1', 'Option 2'])).toEqual('Option 1, Option 2');
  });

  it('should validate cellValue', () => {
    expect(field.validateCellValue(null as any).success).toBe(true);
    expect(field.validateCellValue('Option 1').success).toBe(false);
    expect(field.validateCellValue(['Option 1']).success).toBe(true);
    expect(field.validateCellValue(['Option 3']).success).toBe(false);

    expect(lookupField.validateCellValue(null as any).success).toBe(true);
    expect(lookupField.validateCellValue('Option 1').success).toBe(false);
    expect(lookupField.validateCellValue(['Option 1']).success).toBe(true);
    expect(lookupField.validateCellValue(['Option 3']).success).toBe(false);
  });

  it('should convert string to cellValue', () => {
    expect(field.convertStringToCellValue('text')).toBeNull();
    expect(lookupField.convertStringToCellValue('text')).toBeNull();

    expect(field.convertStringToCellValue('text')).toBeNull();
    expect(lookupField.convertStringToCellValue('text')).toBeNull();
  });

  it('should repair invalid value', () => {
    const cellValue = 'Option 1';
    expect(field.repair([cellValue])).toEqual([cellValue]);
    expect(field.repair('xxxx')).toEqual(null);
  });

  describe('validateOptions', () => {
    it('should return success if options are valid', () => {
      expect(field.validateOptions().success).toBe(true);
    });

    it('should return failure if options are invalid', () => {
      const field = plainToInstance(MultipleSelectFieldCore, {
        ...json,
        options: {
          choices: [
            { name: 'Option 1', color: Colors.Blue },
            { name: 'Option 2', color: 'xxxxx' },
          ],
        },
      });
      expect(field.validateOptions().success).toBe(false);
    });
  });
});
