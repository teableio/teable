/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { plainToInstance } from 'class-transformer';
import { FieldType, DbFieldType, CellValueType } from '../constant';
import { FieldCore } from '../field';
import type { IFieldVo } from '../field.schema';
import type { IAttachmentCellValue } from './attachment.field';
import { AttachmentFieldCore } from './attachment.field';

describe('AttachmentFieldCore', () => {
  let field: AttachmentFieldCore;
  let lookupField: AttachmentFieldCore;
  const json: IFieldVo = {
    id: 'fldtestxxxxxx',
    dbFieldName: 'fldtestxxxxxx',
    name: 'Test attachment Field',
    description: 'A test attachment field',
    options: {},
    type: FieldType.Attachment,
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
    field = plainToInstance(AttachmentFieldCore, json);
    lookupField = plainToInstance(AttachmentFieldCore, {
      ...json,
      ...lookupJson,
    });
  });

  it('should extend parent class', () => {
    expect(field).toBeInstanceOf(FieldCore);
    expect(field).toBeInstanceOf(AttachmentFieldCore);
  });

  it('should convert cellValue to string', () => {
    const cellValue: IAttachmentCellValue = [
      {
        id: 'actxxxxxxxx',
        name: 'test.txt',
        token: 'token',
        size: 2333,
        mimetype: 'text/plain',
        path: '/attachment/xxxxxx',
      },
      {
        id: 'actxxxxxxxy',
        name: 'graph.png',
        token: 'token',
        size: 2333,
        mimetype: 'text/plain',
        path: '/attachment/xxxxxx',
      },
    ];
    expect(field.cellValue2String(null as any)).toBe('');
    expect(field.cellValue2String(cellValue)).toEqual('test.txt (token),graph.png (token)');
    expect(lookupField.cellValue2String(null as any)).toEqual('');
    expect(lookupField.cellValue2String(cellValue)).toEqual('test.txt (token),graph.png (token)');
  });

  it('should validate cellValue', () => {
    const cellValue: IAttachmentCellValue = [
      {
        id: 'actxxxxxxxx',
        name: 'test.txt',
        token: 'token',
        size: 2333,
        mimetype: 'text/plain',
        path: '/attachment/xxxxxx',
      },
      {
        id: 'actxxxxxxxy',
        name: 'graph.png',
        token: 'token',
        size: 2333,
        mimetype: 'text/plain',
        path: '/attachment/xxxxxx',
      },
    ];
    expect(field.validateCellValue(null as any).success).toBe(true);
    expect(field.validateCellValue(cellValue).success).toBe(true);
    expect(field.validateCellValue([{ id: 'actxxx' }]).success).toBe(false);
    expect(field.validateCellValue(cellValue[0]).success).toBe(false);

    expect(lookupField.validateCellValue(null as any).success).toBe(true);
    expect(lookupField.validateCellValue(cellValue).success).toBe(true);
    expect(lookupField.validateCellValue(cellValue[0]).success).toBe(false);
    expect(lookupField.validateCellValue([{ id: 'actxxx' }]).success).toBe(false);
  });

  it('should convert string to cellValue', () => {
    expect(field.convertStringToCellValue('text')).toBeNull();
    expect(lookupField.convertStringToCellValue('text')).toBeNull();
  });

  it('should repair invalid value', () => {
    const cellValue: IAttachmentCellValue = [
      {
        id: 'actxxxxxxxx',
        name: 'test.txt',
        token: 'token',
        size: 2333,
        mimetype: 'text/plain',
        path: '/attachment/xxxxxx',
      },
      {
        id: 'actxxxxxxxy',
        name: 'graph.png',
        token: 'token',
        size: 2333,
        mimetype: 'text/plain',
        path: '/attachment/xxxxxx',
      },
    ];
    expect(field.repair(cellValue)).toEqual(cellValue);
    expect(field.repair([{ id: 'actxxx' }])).toEqual(null);
    expect(lookupField.repair(cellValue)).toEqual(null);
    expect(lookupField.repair([{ id: 'actxxx' }])).toEqual(null);
  });

  it('should convert item to string', () => {
    expect(
      field.item2String({
        id: 'actxxxxxxxx',
        name: 'test.txt',
        token: 'token',
        size: 2333,
        mimetype: 'text/plain',
        path: '/attachment/xxxxxx',
      })
    ).toBe('test.txt (token)');
    expect(field.item2String(null)).toBe('');
  });

  describe('validateOptions', () => {
    it('should return success if options are valid', () => {
      const field = plainToInstance(AttachmentFieldCore, {
        ...json,
        options: {},
      });
      expect(field.validateOptions().success).toBe(true);
    });

    it('should return failure if options are invalid', () => {
      const field = plainToInstance(AttachmentFieldCore, {
        ...json,
        options: null,
      });
      expect(field.validateOptions().success).toBe(false);
    });

    it('should get default options', () => {
      expect(AttachmentFieldCore.defaultOptions()).toEqual({});
    });
  });
});
