import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import type { Prisma } from '@teable-group/db-main-prisma';
import { PrismaService } from '@teable-group/db-main-prisma';
import { ClsService } from 'nestjs-cls';
import { AttachmentsTableService } from './attachments-table.service';

describe('AttachmentsService', () => {
  let service: AttachmentsTableService;
  let prismaService: Prisma.TransactionClient;
  const updateManyError = 'updateMany error';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttachmentsTableService,
        {
          provide: PrismaService,
          useValue: {
            txClient: function () {
              return this;
            },
            attachmentsTable: {
              findMany: jest.fn(),
              create: jest.fn(),
              updateMany: jest.fn(),
            },
          },
        },
      ],
    })
      .useMocker((token) => {
        if (token === ClsService) {
          return {
            get: jest.fn(),
          };
        }
      })
      .compile();

    service = module.get<AttachmentsTableService>(AttachmentsTableService);
    prismaService = module.get<PrismaService>(PrismaService).txClient();
  });

  it('should create unique key', () => {
    expect(service['createUniqueKey']('1', '2', '3', '4')).toEqual('1-2-3-4');
  });

  describe('updateByRecord', () => {
    const tableId = 'tableId';
    const recordId = 'recordId';
    const attachments = [
      {
        attachmentId: 'attachmentId1',
        token: 'token',
        name: 'name',
        fieldId: 'fieldId',
      },
    ];

    it('should update by record if no existing records', async () => {
      (prismaService.attachmentsTable.findMany as jest.Mock).mockResolvedValueOnce([]);
      await service.updateByRecord(tableId, recordId, attachments);
      expect(prismaService.attachmentsTable.create).toHaveBeenCalledTimes(attachments.length);
      expect(prismaService.attachmentsTable.updateMany).not.toBeCalled();
    });

    it('should create new and delete old records if there are existing records', async () => {
      const exists = [
        {
          attachmentId: 'attachmentId2',
          tableId,
          recordId,
          fieldId: 'fieldId',
        },
      ];
      (prismaService.attachmentsTable.findMany as jest.Mock).mockResolvedValueOnce(exists);
      await service.updateByRecord(tableId, recordId, attachments);
      expect(prismaService.attachmentsTable.create).toHaveBeenCalledTimes(attachments.length);
      expect(prismaService.attachmentsTable.updateMany).toBeCalledTimes(exists.length);
    });

    it('should throw error if findMany fails', async () => {
      (prismaService.attachmentsTable.findMany as jest.Mock).mockRejectedValueOnce(
        new Error('findMany error')
      );
      await expect(service.updateByRecord(tableId, recordId, attachments)).rejects.toThrow(
        'findMany error'
      );
      expect(prismaService.attachmentsTable.create).not.toBeCalled();
      expect(prismaService.attachmentsTable.updateMany).not.toBeCalled();
    });

    it('should throw error if create fails', async () => {
      (prismaService.attachmentsTable.findMany as jest.Mock).mockResolvedValueOnce([]);
      (prismaService.attachmentsTable.create as jest.Mock).mockRejectedValueOnce(
        new Error('create error')
      );
      await expect(service.updateByRecord(tableId, recordId, attachments)).rejects.toThrow(
        'create error'
      );
      expect(prismaService.attachmentsTable.create).toBeCalled();
      expect(prismaService.attachmentsTable.updateMany).not.toBeCalled();
    });

    it('should throw error if updateMany fails', async () => {
      const exists = [
        {
          attachmentId: 'attachmentId2',
          tableId,
          recordId,
          fieldId: 'fieldId',
        },
      ];
      (prismaService.attachmentsTable.findMany as jest.Mock).mockResolvedValueOnce(exists);
      (prismaService.attachmentsTable.updateMany as jest.Mock).mockRejectedValueOnce(
        new Error(updateManyError)
      );
      await expect(service.updateByRecord(tableId, recordId, attachments)).rejects.toThrow(
        updateManyError
      );
      expect(prismaService.attachmentsTable.create).toBeCalled();
      expect(prismaService.attachmentsTable.updateMany).toBeCalled();
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
      expect(prismaService.attachmentsTable.updateMany).toBeCalledTimes(queries.length);
    });

    it('should throw error if updateMany fails', async () => {
      (prismaService.attachmentsTable.updateMany as jest.Mock).mockRejectedValueOnce(
        new Error(updateManyError)
      );
      await expect(service.delete(queries)).rejects.toThrow(updateManyError);
      expect(prismaService.attachmentsTable.updateMany).toBeCalled();
    });
  });
});
