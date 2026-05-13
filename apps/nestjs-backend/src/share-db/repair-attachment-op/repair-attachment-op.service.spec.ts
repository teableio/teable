import { RecordOpBuilder } from '@teable/core';
import type { EditOp } from 'sharedb';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@teable/db-main-prisma', () => ({
  PrismaService: class PrismaService {},
}));

import { RepairAttachmentOpService } from './repair-attachment-op.service';

const buildService = () => {
  const prismaService = {
    attachments: {
      findMany: vi.fn().mockResolvedValue([
        {
          token: 'tok-1',
          path: 'table/tok-1',
          size: 123,
          mimetype: 'image/png',
          width: 320,
          height: 180,
          thumbnailPath: JSON.stringify({ sm: 'table/tok-1_sm', lg: 'table/tok-1_lg' }),
        },
      ]),
    },
  };
  const cacheService = {
    getMany: vi.fn().mockResolvedValue([]),
    del: vi.fn(),
  };
  const attachmentsStorageService = {
    getPreviewUrlByPath: vi.fn().mockResolvedValue('/preview/tok-1'),
    getTableThumbnailUrl: vi.fn().mockImplementation(async (path: string) => `/thumb/${path}`),
  };

  const service = new RepairAttachmentOpService(
    prismaService as never,
    cacheService as never,
    attachmentsStorageService as never
  );

  return { service, prismaService, attachmentsStorageService };
};

describe('RepairAttachmentOpService', () => {
  it('repairs attachment ops that only contain token and name', async () => {
    const { service, prismaService, attachmentsStorageService } = buildService();
    const rawOp = {
      op: [
        RecordOpBuilder.editor.setRecord.build({
          fieldId: 'fldAttachment',
          newCellValue: [{ token: 'tok-1', name: 'receipt.png' }],
          oldCellValue: null,
        }),
      ],
    } as EditOp;
    const collection = 'rec_tblAttachment';

    const context = await service.getCollectionsAttachmentsContext([
      { [collection]: { rec1: rawOp } },
    ]);
    const repaired = (await service.repairAttachmentOp(rawOp, context)) as EditOp;
    const repairedValue = repaired.op?.[0]?.oi;

    expect(prismaService.attachments.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { token: { in: ['tok-1'] } } })
    );
    expect(attachmentsStorageService.getPreviewUrlByPath).toHaveBeenCalled();
    expect(repairedValue).toEqual([
      expect.objectContaining({
        token: 'tok-1',
        name: 'receipt.png',
        path: 'table/tok-1',
        mimetype: 'image/png',
        size: 123,
        width: 320,
        height: 180,
        presignedUrl: '/preview/tok-1',
        smThumbnailUrl: '/thumb/table/tok-1_sm',
        lgThumbnailUrl: '/thumb/table/tok-1_lg',
      }),
    ]);
  });
});
