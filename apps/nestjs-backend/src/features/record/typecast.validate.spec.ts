/* eslint-disable @typescript-eslint/no-explicit-any */
import { Colors, FieldType } from '@teable/core';
import type { PrismaService } from '@teable/db-main-prisma';
import { vi } from 'vitest';
import { mockDeep, mockReset } from 'vitest-mock-extended';
import type { AttachmentsStorageService } from '../attachments/attachments-storage.service';
import type { CollaboratorService } from '../collaborator/collaborator.service';
import type { FieldConvertingService } from '../field/field-calculate/field-converting.service';
import type { IFieldInstance } from '../field/model/factory';
import type { SingleSelectFieldDto } from '../field/model/field-dto/single-select-field.dto';
import type { RecordService } from './record.service';
import { TypeCastAndValidate } from './typecast.validate';

vi.mock('zod-validation-error', () => {
  return {
    __esModule: true,
    fromZodError: (message: any) => message,
  };
});

describe('TypeCastAndValidate', () => {
  const prismaService = mockDeep<PrismaService>();
  const fieldConvertingService = mockDeep<FieldConvertingService>();
  const recordService = mockDeep<RecordService>();
  const attachmentsStorageService = mockDeep<AttachmentsStorageService>();
  const collaboratorService = mockDeep<CollaboratorService>();

  const services = {
    prismaService,
    fieldConvertingService,
    recordService,
    attachmentsStorageService,
    collaboratorService,
  };
  const tableId = 'tableId';

  afterEach(() => {
    mockReset(fieldConvertingService);
    mockReset(prismaService);
    mockReset(recordService);
    mockReset(collaboratorService);
  });

  describe('typecastCellValuesWithField', () => {
    it('should call castToSingleSelect for single select field', async () => {
      const field = mockDeep<IFieldInstance>({ type: FieldType.SingleSelect, isComputed: false });
      const typeCastAndValidate = new TypeCastAndValidate({ services, field, tableId });
      const cellValues: unknown[] = [];

      vi.spyOn(typeCastAndValidate as any, 'castToSingleSelect').mockResolvedValue(cellValues);

      const result = await typeCastAndValidate.typecastCellValuesWithField(cellValues);

      expect(result).toEqual(cellValues);
      expect(typeCastAndValidate['castToSingleSelect']).toBeCalledWith(cellValues);
    });

    it('should call castToMultipleSelect for multiple select field', async () => {
      const field = mockDeep<IFieldInstance>({ type: FieldType.MultipleSelect, isComputed: false });
      const typeCastAndValidate = new TypeCastAndValidate({ services, field, tableId });
      const cellValues: unknown[] = [];

      vi.spyOn(typeCastAndValidate as any, 'castToMultipleSelect').mockResolvedValue(cellValues);

      const result = await typeCastAndValidate.typecastCellValuesWithField(cellValues);

      expect(result).toEqual(cellValues);
      expect(typeCastAndValidate['castToMultipleSelect']).toBeCalledWith(cellValues);
    });

    it('should call castToLink for link field', async () => {
      const field = mockDeep<IFieldInstance>({ type: FieldType.Link, isComputed: false });
      const typeCastAndValidate = new TypeCastAndValidate({ services, field, tableId });
      const cellValues: Record<string, unknown>[] = [];

      vi.spyOn(typeCastAndValidate as any, 'castToLink').mockResolvedValue(cellValues);

      const result = await typeCastAndValidate.typecastCellValuesWithField(cellValues);

      expect(result).toEqual(cellValues);
      expect(typeCastAndValidate['castToLink']).toBeCalledWith(cellValues);
    });

    it('should call defaultCastTo for other field', async () => {
      const field = mockDeep<IFieldInstance>({ type: FieldType.SingleLineText, isComputed: false });
      const typeCastAndValidate = new TypeCastAndValidate({ services, field, tableId });
      const cellValues: unknown[] = [];

      vi.spyOn(typeCastAndValidate as any, 'defaultCastTo').mockResolvedValue(cellValues);

      const result = await typeCastAndValidate.typecastCellValuesWithField(cellValues);

      expect(result).toEqual(cellValues);
      expect(typeCastAndValidate['defaultCastTo']).toBeCalledWith(cellValues);
    });

    it('should reject if sub method throws error', async () => {
      const field = mockDeep<IFieldInstance>({ type: FieldType.SingleSelect, isComputed: false });
      const typeCastAndValidate = new TypeCastAndValidate({ services, field, tableId });

      vi.spyOn(typeCastAndValidate as any, 'castToSingleSelect').mockImplementation(() => {
        throw new Error('xxxxx');
      });

      await expect(typeCastAndValidate.typecastCellValuesWithField([])).rejects.toThrow();
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

  describe('mapFieldsCellValuesWithValidate', () => {
    const field = mockDeep<IFieldInstance>({ id: 'fldxxxx' });
    const typeCastAndValidate = new TypeCastAndValidate({
      services,
      field,
      tableId,
      typecast: true,
    });
    it('should map record and apply callback', () => {
      const cellValues = [1];
      const callback = vi.fn(() => 'value');

      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore-next-line
      field.validateCellValue.mockReturnValue({
        success: false,
        error: 'error',
      });

      const result = typeCastAndValidate['mapFieldsCellValuesWithValidate'](cellValues, callback);

      expect(result).toEqual(['value']);
      expect(callback).toBeCalledWith(1);
    });

    it('should throw error when validate fails', () => {
      const cellValues = [1];

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
        typeCastAndValidate['mapFieldsCellValuesWithValidate'](cellValues, vi.fn());
      }).toThrow('Bad Request');
    });

    it('should return null if typecast is false', () => {
      const field = mockDeep<IFieldInstance>();
      const typeCastAndValidate = new TypeCastAndValidate({
        services,
        field,
        tableId,
      });

      field.validateCellValue.mockReturnValue({
        success: true,
      } as any);

      const cellValues = [1];

      const result = typeCastAndValidate['mapFieldsCellValuesWithValidate'](
        cellValues,
        () => 'value'
      );

      expect(result).toEqual([null]);
    });

    it('should not throw error if no field value', () => {
      const cellValues = [1];

      field.validateCellValue.mockReturnValue({
        success: true,
      } as any);

      const result = typeCastAndValidate['mapFieldsCellValuesWithValidate'](cellValues, vi.fn());

      expect(result).toEqual([null]);
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
      fieldConvertingService.stageAnalysis.mockImplementation(() => Promise.resolve({}) as any);

      await typeCastAndValidate['createOptionsIfNotExists'](['1', '2']);

      expect(fieldConvertingService.stageAnalysis).toBeCalledWith(
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
      fieldConvertingService.stageAnalysis.mockImplementation(() => Promise.resolve() as any);
      await typeCastAndValidate['createOptionsIfNotExists']([]);

      expect(fieldConvertingService.stageAnalysis).not.toBeCalled();
    });
  });

  describe('defaultCastTo', () => {
    it('should call mapFieldsCellValuesWithValidate with repair callback', () => {
      const field = mockDeep<IFieldInstance>({ id: 'fldxxxx', repair: () => 'repair' });
      const cellValues = ['value'];
      const typeCastAndValidate = new TypeCastAndValidate({
        services,
        field,
        tableId,
        typecast: true,
      });

      vi.spyOn(typeCastAndValidate as any, 'mapFieldsCellValuesWithValidate').mockImplementation(
        (...args: any[]) => (args[1] as any)()
      );

      const result = typeCastAndValidate['defaultCastTo'](cellValues);

      expect(result).toEqual('repair');
    });
  });

  describe('castToSingleSelect', () => {
    const field = mockDeep<SingleSelectFieldDto>({
      id: 'fldxxxx',
      type: FieldType.SingleSelect,
      options: {
        choices: [{ id: '1', name: 'option 1', color: Colors.Blue }],
        preventAutoNewOptions: false,
      },
    });
    const cellValues = ['value'];
    const typeCastAndValidate = new TypeCastAndValidate({
      services,
      field,
      tableId,
      typecast: true,
    });
    it('should call dependencies correctly and return', async () => {
      vi.spyOn(typeCastAndValidate as any, 'mapFieldsCellValuesWithValidate').mockImplementation(
        (...args: any[]) => (args[1] as any)('value')
      );

      vi.spyOn(typeCastAndValidate as any, 'createOptionsIfNotExists').mockImplementation(
        () => ({})
      );

      const result = await typeCastAndValidate['castToSingleSelect'](cellValues);

      expect(typeCastAndValidate['mapFieldsCellValuesWithValidate']).toBeCalled();
      expect(typeCastAndValidate['createOptionsIfNotExists']).toBeCalledWith(['value']);
      expect(result).toEqual('value');
    });
  });

  describe('castToMultipleSelect', () => {
    const field = mockDeep<SingleSelectFieldDto>({
      id: 'fldxxxx',
      type: FieldType.SingleSelect,
      options: {
        choices: [{ id: '1', name: 'option 1', color: Colors.Blue }],
        preventAutoNewOptions: false,
      },
    });
    const cellValues = ['value'];
    const typeCastAndValidate = new TypeCastAndValidate({
      services,
      field,
      tableId,
      typecast: true,
    });
    it('should call dependencies correctly and return', async () => {
      vi.spyOn(typeCastAndValidate as any, 'mapFieldsCellValuesWithValidate').mockImplementation(
        (...args: any[]) => (args[1] as any)('value')
      );

      vi.spyOn(typeCastAndValidate as any, 'createOptionsIfNotExists').mockImplementation(
        () => ({})
      );

      const result = await typeCastAndValidate['castToMultipleSelect'](cellValues);

      expect(typeCastAndValidate['mapFieldsCellValuesWithValidate']).toBeCalled();
      expect(typeCastAndValidate['createOptionsIfNotExists']).toBeCalledWith(['value']);
      expect(result).toEqual(['value']);
    });
  });
});
