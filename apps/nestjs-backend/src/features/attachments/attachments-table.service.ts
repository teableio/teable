import { Injectable } from '@nestjs/common';
import type { Prisma } from '@teable-group/db-main-prisma';
import { difference } from 'lodash';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';

@Injectable()
export class AttachmentsTableService {
  constructor(private readonly cls: ClsService<IClsStore>) {}

  private createUniqueKey(
    tableId: string,
    fieldId: string,
    recordId: string,
    attachmentId: string
  ) {
    return `${tableId}-${fieldId}-${recordId}-${attachmentId}`;
  }

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
    const userId = this.cls.get('user.id');

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
      const key = this.createUniqueKey(
        tableId,
        recordId,
        attachment.fieldId,
        attachment.attachmentId
      );
      map[key] = {
        ...attachment,
        tableId,
        recordId,
        attachmentId: attachment.attachmentId,
        createdBy: userId,
        lastModifiedBy: userId,
      };
      return map;
    }, {} as { [key: string]: Prisma.AttachmentsTableCreateInput });

    const existsMap = exists.reduce(
      (map, attachment) => {
        const { tableId, recordId, fieldId, attachmentId } = attachment;
        const key = this.createUniqueKey(tableId, recordId, fieldId, attachmentId);
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

  async delete(
    prisma: Prisma.TransactionClient,
    query: {
      tableId: string;
      recordId?: string;
      fieldId?: string;
      attachmentId?: string;
    }[]
  ) {
    const userId = this.cls.get('user.id');

    for (let i = 0; i < query.length; i++) {
      await prisma.attachmentsTable.updateMany({
        where: query[i],
        data: {
          deletedTime: new Date(),
          lastModifiedBy: userId,
        },
      });
    }
  }
}
