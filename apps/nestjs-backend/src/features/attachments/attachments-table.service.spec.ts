/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import type { IAttachmentCellValue, IRecord } from '@teable/core';
import { FieldType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { Mock } from 'vitest';
import { vi } from 'vitest';
import { mockDeep, mockReset } from 'vitest-mock-extended';
import type { IChangeRecord } from '../../event-emitter/events';
import { GlobalModule } from '../../global/global.module';
import { AttachmentsTableModule } from './attachments-table.module';
import { AttachmentsTableService } from './attachments-table.service';

describe('AttachmentsService', () => {
  let service: AttachmentsTableService;
  const updateManyError = 'updateMany error';
  const prismaService = mockDeep<PrismaService>();
  const mockAttachmentCellValue: IAttachmentCellValue = [
    {
      id: 'atc1',
      name: 'attachmentName',
      path: 'attachmentPath',
      token: 'attachmentToken',
      size: 100,
      mimetype: 'image/jpeg',
    },
    {
      id: 'atc2',
      name: 'attachmentName',
      path: 'attachmentPath',
      token: 'attachmentToken',
      size: 100,
      mimetype: 'image/jpeg',
    },
  ];
  const mockAttachmentFields = [{ id: 'field1' }, { id: 'field2' }];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [GlobalModule, AttachmentsTableModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaService)

      .compile();

    service = module.get<AttachmentsTableService>(AttachmentsTableService);
    prismaService.txClient.mockImplementation(() => {
      return prismaService;
    });
    prismaService.$tx.mockImplementation(async (cb) => {
      await cb(prismaService);
    });
  });

  afterEach(() => {
    mockReset(prismaService);
    vi.clearAllMocks();
  });

  it('should create unique key', () => {
    expect(service['createUniqueKey']('1', '2', '3', '4')).toEqual('1-2-3-4');
  });

  describe('getAttachmentFields', () => {
    it('should retrieve attachment fields from Prisma', async () => {
      // Mock data
      const tableId = 'table123';

      // Mock Prisma response
      prismaService.field.findMany.mockResolvedValue(mockAttachmentFields as any);

      // Call the method
      const result = await service['getAttachmentFields'](tableId);

      // Verify that Prisma method was called with the correct parameters
      expect(prismaService.txClient().field.findMany).toHaveBeenCalledWith({
        where: { tableId, type: FieldType.Attachment, isLookup: null, deletedTime: null },
        select: { id: true },
      });

      // Verify the result
      expect(result).toEqual(mockAttachmentFields);
    });
  });

  describe('createRecords', () => {
    it('should create new attachments', async () => {
      // Mock data
      const userId = 'user123';
      const tableId = 'table123';
      const records: IRecord[] = [
        {
          id: 'record1',
          fields: {},
        },
        {
          id: 'record2',
          fields: {
            field1: mockAttachmentCellValue,
          },
        },
      ];

      vi.spyOn(service as any, 'getAttachmentFields').mockResolvedValue(mockAttachmentFields);
      await service.createRecords(userId, tableId, records);

      expect(prismaService.attachmentsTable.createMany).toBeCalled();
    });
  });

  describe('updateRecords', () => {
    it('should update records with new attachments', async () => {
      // Mock data
      const userId = 'user123';
      const tableId = 'table123';
      const records: IChangeRecord[] = [
        {
          id: 'record1',
          fields: {
            field1: {
              newValue: mockAttachmentCellValue,
              oldValue: null,
            },
          },
        },
      ];

      vi.spyOn(service as any, 'getAttachmentFields').mockResolvedValue(mockAttachmentFields);
      vi.spyOn(service, 'delete').mockResolvedValue();

      // Call the method
      await service.updateRecords(userId, tableId, records);

      expect(prismaService.txClient().attachmentsTable.createMany).toBeCalled();
      expect(service.delete).toHaveBeenCalledTimes(0);
    });

    it('should delete attachments for records with old attachments', async () => {
      // Mock data
      const userId = 'user123';
      const tableId = 'table123';
      const mockOldAttachmentCellValue: IAttachmentCellValue = [
        {
          id: 'atc-old1',
          name: 'attachmentName',
          path: 'attachmentPath',
          token: 'attachmentToken',
          size: 100,
          mimetype: 'image/jpeg',
        },
        {
          id: 'atc-old2',
          name: 'attachmentName',
          path: 'attachmentPath',
          token: 'attachmentToken',
          size: 100,
          mimetype: 'image/jpeg',
        },
      ];
      const records: IChangeRecord[] = [
        {
          id: 'record1',
          fields: {
            field1: {
              newValue: mockAttachmentCellValue.slice(0, 1),
              oldValue: mockOldAttachmentCellValue.slice(0, 1),
            },
          },
        },
        {
          id: 'record2',
          fields: {
            field2: {
              newValue: mockAttachmentCellValue.slice(1),
              oldValue: mockOldAttachmentCellValue.slice(1),
            },
          },
        },
      ];

      vi.spyOn(service as any, 'getAttachmentFields').mockResolvedValue(mockAttachmentFields);
      vi.spyOn(service, 'delete').mockResolvedValue();

      await service.updateRecords(userId, tableId, records);

      expect(prismaService.txClient().attachmentsTable.createMany).toBeCalled();
      expect(service.delete).toHaveBeenCalledWith([
        {
          tableId,
          recordId: 'record1',
          fieldId: 'field1',
          attachmentId: 'atc-old1',
        },
        {
          tableId,
          recordId: 'record2',
          fieldId: 'field2',
          attachmentId: 'atc-old2',
        },
      ]);
    });
  });

  describe('delete', () => {
    const queries = [
      {
        tableId: 'tableId',
        recordId: 'recordId',
        fieldId: 'fieldId',
        attachmentId: 'attachmentId',
      },
    ];

    it('should delete records', async () => {
      await service.delete(queries);
      expect(prismaService.attachmentsTable.deleteMany).toBeCalledTimes(queries.length);
    });

    it('should throw error if updateMany fails', async () => {
      (prismaService.attachmentsTable.deleteMany as Mock).mockRejectedValueOnce(
        new Error(updateManyError)
      );
      await expect(service.delete(queries)).rejects.toThrow(updateManyError);
      expect(prismaService.attachmentsTable.deleteMany).toBeCalled();
    });
  });

  describe('deleteRecords', () => {
    it('should delete attachments for specified records', async () => {
      // Mock data
      const tableId = 'table123';
      const recordIds = ['record1', 'record2'];

      // Call the method
      await service.deleteRecords(tableId, recordIds);

      // Verify that Prisma method was called with the correct parameters
      expect(prismaService.txClient().attachmentsTable.deleteMany).toHaveBeenCalledWith({
        where: { tableId, recordId: { in: recordIds } },
      });
    });

    // Add more test cases for different scenarios
  });

  describe('deleteFields', () => {
    it('should delete attachments for specified fields', async () => {
      // Mock data
      const tableId = 'table123';
      const fieldIds = ['field1', 'field2'];

      // Call the method
      await service.deleteFields(tableId, fieldIds);

      // Verify that Prisma method was called with the correct parameters
      expect(prismaService.txClient().attachmentsTable.deleteMany).toHaveBeenCalledWith({
        where: { tableId, fieldId: { in: fieldIds } },
      });
    });
  });

  describe('deleteTable', () => {
    it('should delete all attachments for the specified table', async () => {
      // Mock data
      const tableId = 'table123';

      // Call the method
      await service.deleteTable(tableId);

      // Verify that Prisma method was called with the correct parameters
      expect(prismaService.txClient().attachmentsTable.deleteMany).toHaveBeenCalledWith({
        where: { tableId },
      });
    });
  });
});
