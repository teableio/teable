/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { plainToInstance } from 'class-transformer';
import { CellValueType, DbFieldType, FieldType } from '../constant';
import { FieldCore } from '../field';
import { convertFieldRoSchema } from '../field.schema';
import type { IUserCellValue } from './abstract/user.field.abstract';
import { UserFieldCore } from './user.field';

describe('UserFieldCore', () => {
  let field: UserFieldCore;
  let multipleField: UserFieldCore;
  let lookupField: UserFieldCore;
  let multipleLookupField: UserFieldCore;

  const json = {
    id: 'test',
    name: 'Test User Field',
    description: 'A test user field',
    options: {
      isMultiple: false,
      shouldNotify: true,
    },
    type: FieldType.User,
    dbFieldType: DbFieldType.Json,
    cellValueType: CellValueType.String,
    isComputed: false,
  };

  beforeEach(() => {
    field = plainToInstance(UserFieldCore, json);
    multipleField = plainToInstance(UserFieldCore, {
      ...json,
      options: {
        ...json.options,
        isMultiple: true,
      },
      isMultipleCellValue: true,
    });

    const lookupJson = {
      isLookup: true,
      isComputed: true,
    };
    lookupField = plainToInstance(UserFieldCore, {
      ...json,
      ...lookupJson,
      isMultipleCellValue: false,
    });
    multipleLookupField = plainToInstance(UserFieldCore, {
      ...json,
      ...lookupJson,
      isMultipleCellValue: true,
    });
  });

  it('should extend parent class', () => {
    expect(field).toBeInstanceOf(FieldCore);
    expect(field).toBeInstanceOf(UserFieldCore);
  });

  it('should convert cellValue to string', () => {
    const cellValue: IUserCellValue = {
      id: 'usrxxxxxxxxx',
      title: 'anonymous',
      email: 'anonymous@teable.io',
    };

    expect(field.cellValue2String(null as any)).toBe('');
    expect(field.cellValue2String(cellValue)).toEqual('anonymous');

    expect(multipleField.cellValue2String(null as any)).toBe('');
    expect(multipleField.cellValue2String([cellValue, cellValue])).toEqual('anonymous, anonymous');

    expect(lookupField.cellValue2String(null as any)).toEqual('');
    expect(lookupField.cellValue2String(cellValue)).toEqual('anonymous');

    expect(multipleLookupField.cellValue2String(null as any)).toEqual('');
    expect(multipleLookupField.cellValue2String(cellValue)).toEqual('anonymous');
    expect(multipleLookupField.cellValue2String([cellValue, cellValue])).toEqual(
      'anonymous, anonymous'
    );
    expect(multipleLookupField.cellValue2String([cellValue, null as any])).toEqual('anonymous, ');
  });

  it('should convert string to cellValue', () => {
    const ctx = {
      userSets: [
        {
          id: 'usr1234567',
          name: 'anonymous',
          email: 'anonymous@teable.io',
        },
      ],
    };

    expect(field.convertStringToCellValue('anonymous', ctx)).toEqual({
      id: 'usr1234567',
      title: 'anonymous',
      email: 'anonymous@teable.io',
    });
    expect(field.convertStringToCellValue('anonymous@teable.io', ctx)).toEqual({
      id: 'usr1234567',
      title: 'anonymous',
      email: 'anonymous@teable.io',
    });

    ctx.userSets.push({
      id: 'usrA2',
      name: 'anonymous',
      email: 'a2@teable.io',
    });
    expect(field.convertStringToCellValue('anonymous', ctx)).toBeNull();
    expect(field.convertStringToCellValue('name', ctx)).toBeNull();
  });

  it('should convert item to string', () => {
    expect(field.item2String({ id: 'usr' })).toBe('');
    expect(field.item2String({ id: 'usr', title: 'anonymous' })).toBe('anonymous');
    expect(field.item2String(null)).toBe('');
  });

  it('should repair invalid value', () => {
    const cellValue: IUserCellValue = {
      id: 'usr',
      title: 'anonymous',
      email: 'anonymous@teable.io',
    };
    expect(field.repair(cellValue)).toEqual(cellValue);
    expect(field.repair([{ id: 'usr' }])).toEqual(null);

    expect(multipleField.repair([cellValue])).toEqual([cellValue]);
    expect(multipleField.repair(cellValue)).toEqual(null);

    expect(lookupField.repair(cellValue)).toEqual(null);
    expect(lookupField.repair({ id: 'usr' })).toEqual(null);

    expect(multipleLookupField.repair(cellValue)).toEqual(null);
    expect(multipleLookupField.repair([{ id: 'actxxx' }])).toEqual(null);
  });

  it('should validate value', () => {
    const cellValue: IUserCellValue = {
      id: 'usr',
      title: 'anonymous',
      email: 'anonymous@teable.io',
    };

    expect(field.validateCellValue(null as any).success).toBe(true);
    expect(field.validateCellValue(cellValue).success).toBe(true);
    expect(
      field.validateCellValue({ id: 'usrxxxxxx ', title: '', email: 'anonymous@teable.io' }).success
    ).toBe(true);
    expect(field.validateCellValue([cellValue]).success).toBe(false);
  });

  describe('validateOptions', () => {
    it('should return success if options are valid', () => {
      expect(convertFieldRoSchema.safeParse(json).success).toBeTruthy();
    });

    it('should return failure if options are invalid', () => {
      expect(
        plainToInstance(UserFieldCore, {
          ...json,
          options: null,
        }).validateOptions().success
      ).toBeFalsy();
    });
  });
});
