/* eslint-disable @typescript-eslint/no-explicit-any */
import { Colors, FieldKeyType, FieldType } from '@teable-group/core';
import type { PrismaService } from '@teable-group/db-main-prisma';
import { mockDeep, mockReset } from 'jest-mock-extended';
import type { FieldConvertingService } from '../field/field-calculate/field-converting.service';
import type { IFieldInstance } from '../field/model/factory';
import type { LinkFieldDto } from '../field/model/field-dto/link-field.dto';
import type { SingleSelectFieldDto } from '../field/model/field-dto/single-select-field.dto';
import type { RecordService } from './record.service';
import { TypeCastAndValidate } from './typecast.validate';

jest.mock('zod-validation-error', () => {
  return {
    __esModule: true,
    fromZodError: (message: any) => message,
  };
});

describe('TypeCastAndValidate', () => {
  const prismaService = mockDeep<PrismaService>();
  const fieldConvertingService = mockDeep<FieldConvertingService>();
  const recordService = mockDeep<RecordService>();

  const services = {
    prismaService,
    fieldConvertingService,
    recordService,
  };
  const tableId = 'tableId';

  afterEach(() => {
    mockReset(fieldConvertingService);
    mockReset(prismaService);
    mockReset(recordService);
  });

  describe('typecastRecordsWithField', () => {
    it('should call castToSingleSelect for single select field', async () => {
      const field = mockDeep<IFieldInstance>({ type: FieldType.SingleSelect, isComputed: false });
      const typeCastAndValidate = new TypeCastAndValidate({ services, field, tableId });
      const records: Record<string, unknown>[] = [];

      jest.spyOn(typeCastAndValidate as any, 'castToSingleSelect').mockResolvedValue(records);

      const result = await typeCastAndValidate.typecastRecordsWithField(records);

      expect(result).toEqual(records);
      expect(typeCastAndValidate['castToSingleSelect']).toBeCalledWith(records, FieldKeyType.Name);
    });

    it('should call castToMultipleSelect for multiple select field', async () => {
      const field = mockDeep<IFieldInstance>({ type: FieldType.MultipleSelect, isComputed: false });
      const typeCastAndValidate = new TypeCastAndValidate({ services, field, tableId });
      const records: Record<string, unknown>[] = [];

      jest.spyOn(typeCastAndValidate as any, 'castToMultipleSelect').mockResolvedValue(records);

      const result = await typeCastAndValidate.typecastRecordsWithField(records);

      expect(result).toEqual(records);
      expect(typeCastAndValidate['castToMultipleSelect']).toBeCalledWith(
        records,
        FieldKeyType.Name
      );
    });

    it('should call castToLink for link field', async () => {
      const field = mockDeep<IFieldInstance>({ type: FieldType.Link, isComputed: false });
      const typeCastAndValidate = new TypeCastAndValidate({ services, field, tableId });
      const records: Record<string, unknown>[] = [];

      jest.spyOn(typeCastAndValidate as any, 'castToLink').mockResolvedValue(records);

      const result = await typeCastAndValidate.typecastRecordsWithField(records);

      expect(result).toEqual(records);
      expect(typeCastAndValidate['castToLink']).toBeCalledWith(records, FieldKeyType.Name);
    });

    it('should call defaultCastTo for other field', async () => {
      const field = mockDeep<IFieldInstance>({ type: FieldType.SingleLineText, isComputed: false });
      const typeCastAndValidate = new TypeCastAndValidate({ services, field, tableId });
      const records: Record<string, unknown>[] = [];

      jest.spyOn(typeCastAndValidate as any, 'defaultCastTo').mockResolvedValue(records);

      const result = await typeCastAndValidate.typecastRecordsWithField(records);

      expect(result).toEqual(records);
      expect(typeCastAndValidate['defaultCastTo']).toBeCalledWith(records, FieldKeyType.Name);
    });

    it('should reject if sub method throws error', async () => {
      const field = mockDeep<IFieldInstance>({ type: FieldType.SingleSelect, isComputed: false });
      const typeCastAndValidate = new TypeCastAndValidate({ services, field, tableId });

      jest.spyOn(typeCastAndValidate as any, 'castToSingleSelect').mockImplementation(() => {
        throw new Error('xxxxx');
      });

      await expect(typeCastAndValidate.typecastRecordsWithField([])).rejects.toThrow();
    });
  });

  describe('valueToStringArray', () => {
    const typeCastAndValidate = new TypeCastAndValidate({
      services,
      field: mockDeep<IFieldInstance>(),
      tableId,
    });
    it('should return null for null value', () => {
      const result = typeCastAndValidate['valueToStringArray'](null);
      expect(result).toBeNull();
    });

    it('should convert array to string array', () => {
      const value = [1, '2', null, undefined];
      const result = typeCastAndValidate['valueToStringArray'](value);
      expect(result).toEqual(['1', '2']);
    });

    it('should return single element array for string', () => {
      const value = 'str';
      const result = typeCastAndValidate['valueToStringArray'](value);
      expect(result).toEqual(['str']);
    });

    it('should convert object to string', () => {
      const value = { toString: () => 'obj' };
      const result = typeCastAndValidate['valueToStringArray'](value);
      expect(result).toEqual(['obj']);
    });

    it('should filter out null values in array', () => {
      const value = [1, null, 2];
      const result = typeCastAndValidate['valueToStringArray'](value);
      expect(result).toEqual(['1', '2']);
    });

    it('should filter out empty string values', () => {
      const value = ['1', '', '2'];
      const result = typeCastAndValidate['valueToStringArray'](value);
      expect(result).toEqual(['1', '2']);
    });

    it('should handle error when toString throws', () => {
      const value = {
        toString: () => {
          throw new Error();
        },
      };
      expect(() => typeCastAndValidate['valueToStringArray'](value)).toThrow();
    });
  });

  describe('mapFieldsRecordsWithValidate', () => {
    const field = mockDeep<IFieldInstance>({ id: 'fldxxxx' });
    const typeCastAndValidate = new TypeCastAndValidate({
      services,
      field,
      tableId,
      typecast: true,
    });
    it('should map record and apply callback', () => {
      const records = [{ [field.id]: 1 }];
      const callback = jest.fn(() => 'value');

      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore-next-line
      field.validateCellValue.mockReturnValue({
        success: false,
        error: 'error',
      });

      const result = typeCastAndValidate['mapFieldsRecordsWithValidate'](
        records,
        FieldKeyType.Id,
        callback
      );

      expect(result).toEqual([{ [field.id]: 'value' }]);
      expect(callback).toBeCalledWith(1);
    });

    it('should throw error when validate fails', () => {
      const records = [{ [field.id]: 1 }];

      const typeCastAndValidate = new TypeCastAndValidate({
        services,
        field,
        tableId,
      });

      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore-next-line
      field.validateCellValue.mockReturnValue({
        success: false,
        error: 'error',
      });

      expect(() => {
        typeCastAndValidate['mapFieldsRecordsWithValidate'](records, FieldKeyType.Id, jest.fn());
      }).toThrow('Bad Request');
    });

    it('should return original record if typecast is false', () => {
      const typeCastAndValidate = new TypeCastAndValidate({
        services,
        field: mockDeep<IFieldInstance>(),
        tableId,
      });

      field.validateCellValue.mockReturnValue({
        success: true,
      } as any);

      const records = [{ [field.id]: 1 }];

      const result = typeCastAndValidate['mapFieldsRecordsWithValidate'](
        records,
        FieldKeyType.Id,
        () => 'value'
      );

      expect(result).toEqual(records);
    });

    it('should not throw error if no field value', () => {
      const records = [{ other: 1 }];

      field.validateCellValue.mockReturnValue({
        success: true,
      } as any);

      const result = typeCastAndValidate['mapFieldsRecordsWithValidate'](
        records,
        FieldKeyType.Id,
        jest.fn()
      );

      expect(result).toEqual(records);
    });
  });

  describe('createOptionsIfNotExists', () => {
    const field = {
      id: 'fldxxxx',
      type: FieldType.SingleSelect,
      options: { choices: [{ id: 'xxx', name: '1', color: Colors.Blue }] },
    } as any;
    const typeCastAndValidate = new TypeCastAndValidate({
      services,
      field,
      tableId,
      typecast: true,
    });

    it('should create new options and update field', async () => {
      fieldConvertingService.updateFieldById.mockImplementation();

      await typeCastAndValidate['createOptionsIfNotExists'](['1', '2']);

      expect(fieldConvertingService.updateFieldById).toBeCalledWith(
        tableId,
        field.id,
        expect.objectContaining({
          type: FieldType.SingleSelect,
          options: expect.objectContaining({
            choices: expect.arrayContaining([
              expect.objectContaining({ name: '1' }),
              expect.objectContaining({ name: '2' }),
            ]),
          }),
        })
      );
    });

    it('should return if no options', async () => {
      fieldConvertingService.updateFieldById.mockImplementation();
      await typeCastAndValidate['createOptionsIfNotExists']([]);

      expect(fieldConvertingService.updateFieldById).not.toBeCalled();
    });
  });

  describe('defaultCastTo', () => {
    it('should call mapFieldsRecordsWithValidate with repair callback', () => {
      const field = mockDeep<IFieldInstance>({ id: 'fldxxxx', repair: () => 'repair' });
      const records = [{ [field.id]: 'value' }];
      const typeCastAndValidate = new TypeCastAndValidate({
        services,
        field,
        tableId,
        typecast: true,
      });

      jest
        .spyOn(typeCastAndValidate as any, 'mapFieldsRecordsWithValidate')
        .mockImplementation((...args) => (args[2] as any)());

      const result = typeCastAndValidate['defaultCastTo'](records, FieldKeyType.Id);

      expect(result).toEqual('repair');
    });
  });

  describe('castToSingleSelect', () => {
    const field = mockDeep<SingleSelectFieldDto>({
      id: 'fldxxxx',
      type: FieldType.SingleSelect,
      options: { choices: [{ id: '1', name: 'option 1', color: Colors.Blue }] },
    });
    const records = [{ [field.id]: 'value' }];
    const typeCastAndValidate = new TypeCastAndValidate({
      services,
      field,
      tableId,
      typecast: true,
    });
    it('should call dependencies correctly and return', async () => {
      jest
        .spyOn(typeCastAndValidate as any, 'mapFieldsRecordsWithValidate')
        .mockImplementation((...args) => (args[2] as any)('value'));

      jest.spyOn(typeCastAndValidate as any, 'createOptionsIfNotExists').mockImplementation();

      const result = await typeCastAndValidate['castToSingleSelect'](records, FieldKeyType.Id);

      expect(typeCastAndValidate['mapFieldsRecordsWithValidate']).toBeCalled();
      expect(typeCastAndValidate['createOptionsIfNotExists']).toBeCalledWith(['value']);
      expect(result).toEqual('value');
    });
  });

  describe('castToMultipleSelect', () => {
    const field = mockDeep<SingleSelectFieldDto>({
      id: 'fldxxxx',
      type: FieldType.SingleSelect,
      options: { choices: [{ id: '1', name: 'option 1', color: Colors.Blue }] },
    });
    const records = [{ [field.id]: 'value' }];
    const typeCastAndValidate = new TypeCastAndValidate({
      services,
      field,
      tableId,
      typecast: true,
    });
    it('should call dependencies correctly and return', async () => {
      jest
        .spyOn(typeCastAndValidate as any, 'mapFieldsRecordsWithValidate')
        .mockImplementation((...args) => (args[2] as any)('value'));

      jest.spyOn(typeCastAndValidate as any, 'createOptionsIfNotExists').mockImplementation();

      const result = await typeCastAndValidate['castToMultipleSelect'](records, FieldKeyType.Id);

      expect(typeCastAndValidate['mapFieldsRecordsWithValidate']).toBeCalled();
      expect(typeCastAndValidate['createOptionsIfNotExists']).toBeCalledWith(['value']);
      expect(result).toEqual(['value']);
    });
  });

  describe('getLinkTableRecordMap', () => {
    const field = mockDeep<LinkFieldDto>({
      id: 'fldxxxx',
      type: FieldType.Link,
      options: { foreignTableId: 'foreignTableId' },
    });
    const typeCastAndValidate = new TypeCastAndValidate({
      services,
      field,
      tableId,
      typecast: true,
    });
    it('should call dependencies correctly and return recordMap', async () => {
      recordService.getRecordsWithPrimary.mockResolvedValue([{ id: '1', title: 'title1' }]);

      const result = await typeCastAndValidate['getLinkTableRecordMap']();

      expect(recordService.getRecordsWithPrimary).toBeCalledWith('foreignTableId');
      expect(result).toEqual({
        title1: '1',
      });
    });
  });

  describe('castToLinkOne', () => {
    const typeCastAndValidate = new TypeCastAndValidate({
      services,
      field: mockDeep<IFieldInstance>(),
      tableId,
      typecast: true,
    });

    it('should cast value correctly and return one linkCellValue', () => {
      typeCastAndValidate['field'].isMultipleCellValue = true;
      const result = typeCastAndValidate['castToLinkOne'](['a', 'b', 'c'], { a: '1', b: '2' });

      expect(result).toEqual([
        { title: 'a', id: '1' },
        { title: 'b', id: '2' },
      ]);
    });

    it('should cast value correctly and return multipleCellValue linkCellValue', () => {
      typeCastAndValidate['field'].isMultipleCellValue = false;
      const result = typeCastAndValidate['castToLinkOne'](['a', 'b', 'c'], { a: '1', b: '2' });

      expect(result).toEqual({ title: 'a', id: '1' });
    });
  });

  describe('castToLink', () => {
    const field = mockDeep<LinkFieldDto>();
    const records = [{ [field.id]: 'value' }];
    const typeCastAndValidate = new TypeCastAndValidate({
      services,
      field,
      tableId,
      typecast: true,
    });
    it('should call dependencies correctly and return map by typecast', async () => {
      jest.spyOn(typeCastAndValidate as any, 'getLinkTableRecordMap').mockResolvedValue({});

      jest
        .spyOn(typeCastAndValidate as any, 'mapFieldsRecordsWithValidate')
        .mockImplementation((...args) => (args[2] as any)('title'));

      jest
        .spyOn(typeCastAndValidate as any, 'castToLinkOne')
        .mockReturnValue({ title1: '1' } as any);

      const result = await typeCastAndValidate['castToLink'](records, FieldKeyType.Id);

      expect(result).toEqual({ title1: '1' });
    });
  });
});
