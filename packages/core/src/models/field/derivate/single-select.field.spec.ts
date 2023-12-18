/* eslint-disable @typescript-eslint/no-explicit-any */
import { plainToInstance } from 'class-transformer';
import { Colors } from '../colors';
import { CellValueType, DbFieldType, FieldType } from '../constant';
import { FieldCore } from '../field';
import type { IFieldVo } from '../field.schema';
import type { ISingleSelectCellValue } from './single-select.field';
import { SingleSelectFieldCore } from './single-select.field';

describe('SingleSelectFieldCore', () => {
  let field: SingleSelectFieldCore;
  let lookupField: SingleSelectFieldCore;
  let multipleField: SingleSelectFieldCore;
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
    dbFieldType: DbFieldType.Text,
    cellValueType: CellValueType.String,
    isMultipleCellValue: false,
    isComputed: false,
  };
  const lookupJson = {
    isLookup: true,
    isComputed: true,
  };

  beforeEach(() => {
    field = plainToInstance(SingleSelectFieldCore, json);
    lookupField = plainToInstance(SingleSelectFieldCore, {
      ...json,
      ...lookupJson,
    });
    multipleField = plainToInstance(SingleSelectFieldCore, {
      ...json,
      isMultipleCellValue: true,
    });
  });

  it('should extend parent class', () => {
    expect(field).toBeInstanceOf(FieldCore);
    expect(field).toBeInstanceOf(SingleSelectFieldCore);
  });

  it('should convert cellValue to string', () => {
    const cellValue: ISingleSelectCellValue = 'Option 1';
    expect(field.cellValue2String(null as any)).toBe('');
    expect(field.cellValue2String(cellValue)).toEqual('Option 1');

    expect(lookupField.cellValue2String(null as any)).toEqual('');
    expect(lookupField.cellValue2String(cellValue)).toEqual('Option 1');

    expect(multipleField.cellValue2String(null as any)).toEqual('');
    expect(multipleField.cellValue2String(cellValue)).toEqual('Option 1');
  });

  it('should validate cellValue', () => {
    const cellValue: ISingleSelectCellValue = 'Option 1';
    expect(field.validateCellValue(null as any).success).toBe(true);
    expect(field.validateCellValue(cellValue).success).toBe(true);
    expect(field.validateCellValue('opt xx').success).toBe(false);
    expect(field.validateCellValue([cellValue]).success).toBe(false);

    expect(lookupField.validateCellValue(null as any).success).toBe(true);
    expect(lookupField.validateCellValue(cellValue).success).toBe(true);
    expect(lookupField.validateCellValue('opt xx').success).toBe(false);
    expect(lookupField.validateCellValue([cellValue]).success).toBe(false);

    expect(multipleField.validateCellValue(cellValue).success).toBe(false);
    expect(multipleField.validateCellValue([cellValue]).success).toBe(true);
  });

  it('should convert string to cellValue', () => {
    expect(field.convertStringToCellValue('Option 1')).toEqual('Option 1');
    expect(field.convertStringToCellValue('Option\n1')).toEqual('Option 1');

    expect(field.convertStringToCellValue('text')).toBeNull();
    expect(lookupField.convertStringToCellValue('Option 1')).toBeNull();
  });

  it('should repair invalid value', () => {
    const cellValue = 'Option 1';
    expect(field.repair(cellValue)).toEqual(cellValue);
    expect(field.repair('xxxx')).toEqual(null);
    expect(lookupField.repair(cellValue)).toEqual(null);
    expect(lookupField.repair('xxxx')).toEqual(null);
  });

  describe('validateOptions', () => {
    it('should return success if options are valid', () => {
      expect(field.validateOptions().success).toBe(true);
    });

    it('should return failure if options are invalid', () => {
      const field = plainToInstance(SingleSelectFieldCore, {
        ...json,
        options: {
          choices: [
            { id: 'cho1', name: 'Option 1', color: Colors.Blue },
            { id: 'cho2', name: 'Option 2', color: 'xxxxx' },
          ],
        },
      });
      expect(field.validateOptions().success).toBe(false);
    });
  });
});
