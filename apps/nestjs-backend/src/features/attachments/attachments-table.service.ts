import { Injectable } from '@nestjs/common';
import type { IAttachment } from '@teable-group/core';
import type { Attachments, Prisma } from '@teable-group/db-main-prisma';
import { difference } from 'lodash';

@Injectable()
export class AttachmentsTableService {
  async updateByRecord(
    prisma: Prisma.TransactionClient,
    tableId: string,
    recordId: string,
    _attachments: {
      attachmentId: string;
      token: string;
      name: string;
      fieldId: string;
    }[]
  ) {
    const exists = await prisma.attachmentsTable.findMany({
      where: {
        tableId,
        recordId,
        deletedTime: null,
      },
      select: {
        attachmentId: true,
        tableId: true,
        recordId: true,
        fieldId: true,
      },
    });
    const attachmentsMap = _attachments.reduce((map, attachment) => {
      const key = `${tableId}-${attachment.fieldId}-${recordId}-${attachment.attachmentId}`;
      map[key] = {
        ...attachment,
        tableId,
        recordId,
        attachmentId: attachment.attachmentId,
        createdBy: '',
        lastModifiedBy: '',
      };
      return map;
    }, {} as { [key: string]: Prisma.AttachmentsTableCreateInput });

    const existsMap = exists.reduce(
      (map, attachment) => {
        const { tableId, recordId, fieldId, attachmentId } = attachment;
        const key = `${tableId}-${fieldId}-${recordId}-${attachmentId}`;
        map[key] = { tableId, recordId, fieldId, attachmentId };
        return map;
      },
      {} as {
        [key: string]: {
          tableId: string;
          recordId?: string;
          fieldId?: string;
          attachmentId?: string;
        };
      }
    );

    const existsKeys = Object.keys(existsMap);

    const attachmentsKeys = Object.keys(attachmentsMap);

    const needDeleteKey = difference(existsKeys, attachmentsKeys);
    const needCreateKey = difference(attachmentsKeys, existsKeys);

    for (let i = 0; i < needCreateKey.length; i++) {
      await prisma.attachmentsTable.create({ data: attachmentsMap[needCreateKey[i]] });
    }

    await this.delete(
      prisma,
      needDeleteKey.map((key) => existsMap[key])
    );
  }

  async getAttachmentTableCellValueByRecordIds(
    prisma: Prisma.TransactionClient,
    query: {
      tableId: string;
      recordIds: string[];
    }
  ): Promise<(IAttachment & { recordId: string; fieldId: string })[]> {
    const { tableId, recordIds } = query;
    const attachmentsTable = await prisma.attachmentsTable.findMany({
      where: {
        tableId,
        recordId: { in: recordIds },
        deletedTime: null,
      },
      select: {
        attachmentId: true,
        name: true,
        token: true,
        recordId: true,
        fieldId: true,
      },
    });

    const tokens = new Set(attachmentsTable.map((v) => v.token));

    const attachments = await prisma.attachments.findMany({
      where: {
        token: { in: [...tokens] },
        deletedTime: null,
      },
      select: {
        size: true,
        path: true,
        mimetype: true,
        token: true,
      },
    });
    const attachmentsMap = attachments.reduce<{
      [token: string]: Pick<Attachments, 'size' | 'path' | 'mimetype' | 'token'>;
    }>((map, attachment) => {
      map[attachment.token] = attachment;
      return map;
    }, {});

    if (!attachmentsTable.length || !attachments.length) {
      return [];
    }
    return attachmentsTable.map(({ attachmentId, name, token, recordId, fieldId }) => {
      const { size, path, mimetype } = attachmentsMap[token];
      return {
        id: attachmentId,
        token,
        name,
        size,
        path,
        mimetype,
        recordId,
        fieldId,
      };
    });
  }

  async delete(
    prisma: Prisma.TransactionClient,
    query: {
      tableId: string;
      recordId?: string;
      fieldId?: string;
      attachmentId?: string;
    }[]
  ) {
    for (let i = 0; i < query.length; i++) {
      await prisma.attachmentsTable.updateMany({
        where: query[i],
        data: {
          deletedTime: new Date(),
        },
      });
    }
  }
}
