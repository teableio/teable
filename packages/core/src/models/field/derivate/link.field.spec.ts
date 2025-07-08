/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { plainToInstance } from 'class-transformer';
import { FieldType, DbFieldType, CellValueType, Relationship } from '../constant';
import { FieldCore } from '../field';
import type { IFieldVo } from '../field.schema';
import type { ILinkCellValue } from './link.field';
import { linkFieldOptionsRoSchema, LinkFieldCore } from './link.field';

describe('LinkFieldCore', () => {
  let field: LinkFieldCore;
  let lookupField: LinkFieldCore;
  let fieldMultiple: LinkFieldCore;
  const json: IFieldVo = {
    id: 'fldtestxxxxxx',
    dbFieldName: 'fldtestxxxxxx',
    name: 'Test link Field',
    description: 'A test link field',
    options: {
      relationship: Relationship.ManyOne,
      foreignTableId: 'tblxxxxxxx',
      lookupFieldId: 'fldxxxxxxx',
      fkHostTableName: 'dbTableName',
      selfKeyName: '__id',
      foreignKeyName: '__fk_fldxxxxxxx',
      symmetricFieldId: 'fldxxxxxxx',
      filterByViewId: 'viwxxxxxxx',
      visibleFieldIds: ['fldxxxxxxx'],
      filter: {
        conjunction: 'and',
        filterSet: [],
      },
    },
    type: FieldType.Link,
    dbFieldType: DbFieldType.Json,
    cellValueType: CellValueType.String,
    isMultipleCellValue: false,
    isComputed: false,
  };

  const lookupJson = {
    isLookup: true,
    isComputed: true,
  };

  beforeEach(() => {
    field = plainToInstance(LinkFieldCore, json);
    lookupField = plainToInstance(LinkFieldCore, {
      ...json,
      ...lookupJson,
    });
    fieldMultiple = plainToInstance(LinkFieldCore, {
      ...json,
      isMultipleCellValue: true,
    });
  });

  it('should extend parent class', () => {
    expect(field).toBeInstanceOf(FieldCore);
    expect(field).toBeInstanceOf(LinkFieldCore);
  });

  it('should convert cellValue to string', () => {
    const cellValue: ILinkCellValue = {
      id: 'recxxxxxxxx',
      title: 'record 1',
    };

    expect(field.cellValue2String(null as any)).toBe('');
    expect(field.cellValue2String(cellValue)).toEqual('record 1');

    expect(lookupField.cellValue2String(null as any)).toEqual('');
    expect(lookupField.cellValue2String(cellValue)).toEqual('record 1');

    expect(fieldMultiple.cellValue2String(null as any)).toEqual('');
    expect(fieldMultiple.cellValue2String(cellValue)).toEqual('record 1');
    expect(fieldMultiple.cellValue2String([cellValue, cellValue])).toEqual('record 1, record 1');
    expect(fieldMultiple.cellValue2String([cellValue, { id: 'rec22222222' }])).toEqual(
      'record 1, '
    );
  });

  it('should validate cellValue', () => {
    const cellValue: ILinkCellValue = {
      id: 'recxxxxxxxx',
      title: 'record 1',
    };

    expect(field.validateCellValue(null as any).success).toBe(true);
    expect(field.validateCellValue(cellValue).success).toBe(true);
    expect(field.validateCellValue({ id: 'recXXXXXXXX ' }).success).toBe(true);
    expect(field.validateCellValue({ id: 'xxxxxxxxxxx ' }).success).toBe(false);
    expect(field.validateCellValue([cellValue]).success).toBe(false);

    expect(lookupField.validateCellValue(null as any).success).toBe(true);
    expect(lookupField.validateCellValue(cellValue).success).toBe(true);
    expect(lookupField.validateCellValue([cellValue]).success).toBe(false);

    expect(fieldMultiple.validateCellValue(null as any).success).toBe(true);
    expect(fieldMultiple.validateCellValue(cellValue).success).toBe(false);
    expect(fieldMultiple.validateCellValue([cellValue, cellValue]).success).toBe(true);
    expect(fieldMultiple.validateCellValue([]).success).toBe(false);
  });

  it('should convert string to cellValue', () => {
    expect(field.convertStringToCellValue('text')).toBeNull();
    expect(lookupField.convertStringToCellValue('text')).toBeNull();
  });

  it('should convert item to string', () => {
    expect(field.item2String({ id: 'rec' })).toBe('');
    expect(field.item2String({ id: 'rec', title: 'A1' })).toBe('A1');
    expect(field.item2String(null)).toBe('');
  });

  it('should repair invalid value', () => {
    const cellValue: ILinkCellValue = {
      id: 'recxxxxxxxx',
      title: 'record 1',
    };
    expect(field.repair(cellValue)).toEqual(cellValue);
    expect(field.repair([{ id: 'actxxx' }])).toEqual(null);

    expect(lookupField.repair(cellValue)).toEqual(null);
    expect(lookupField.repair([{ id: 'actxxx' }])).toEqual(null);

    expect(fieldMultiple.repair(cellValue)).toEqual(null);
    expect(fieldMultiple.repair([cellValue])).toEqual([cellValue]);
  });

  describe('validateOptions', () => {
    it('should return success if options are valid', () => {
      expect(field.validateOptions().success).toBe(true);
    });

    it('should return failure if options are invalid', () => {
      const field = plainToInstance(LinkFieldCore, {
        ...json,
        options: null,
      });
      expect(field.validateOptions().success).toBe(false);
    });

    it('should validate ro schema with strip', () => {
      const object = {
        relationship: 'manyOne',
        foreignTableId: 'tblERSkHpp4KDRK1hvL',
        lookupFieldId: 'fldXWPHcgSGeKgFFuOI',
        dbForeignKeyName: '__fk_fldiBBKwOZuW8rlrtoW',
        symmetricFieldId: 'fld8bh5u0MkjdmtFCxv',
        filterByViewId: 'viwXWPHcgSGeKgFFuOI',
        visibleFieldIds: ['fldXWPHcgSGeKgFFuOI'],
        filter: {
          conjunction: 'and',
          filterSet: [],
        },
      };
      expect(linkFieldOptionsRoSchema.safeParse(object).success).toBeTruthy();
      expect(linkFieldOptionsRoSchema.parse(object)).toEqual({
        relationship: 'manyOne',
        foreignTableId: 'tblERSkHpp4KDRK1hvL',
        lookupFieldId: 'fldXWPHcgSGeKgFFuOI',
        filterByViewId: 'viwXWPHcgSGeKgFFuOI',
        visibleFieldIds: ['fldXWPHcgSGeKgFFuOI'],
        filter: {
          conjunction: 'and',
          filterSet: [],
        },
      });
    });
  });
});
