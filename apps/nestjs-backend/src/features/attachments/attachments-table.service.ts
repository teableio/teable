import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable-group/db-main-prisma';
import type { Prisma } from '@teable-group/db-main-prisma';
import { difference } from 'lodash';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';

@Injectable()
export class AttachmentsTableService {
  constructor(
    private readonly cls: ClsService<IClsStore>,
    private readonly prismaService: PrismaService
  ) {}

  private createUniqueKey(
    tableId: string,
    fieldId: string,
    recordId: string,
    attachmentId: string
  ) {
    return `${tableId}-${fieldId}-${recordId}-${attachmentId}`;
  }

  async updateByRecord(
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

    const exists = await this.prismaService.txClient().attachmentsTable.findMany({
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
          recordId: string;
          fieldId: string;
          attachmentId: string;
        };
      }
    );

    const existsKeys = Object.keys(existsMap);

    const attachmentsKeys = Object.keys(attachmentsMap);

    const needDeleteKey = difference(existsKeys, attachmentsKeys);
    const needCreateKey = difference(attachmentsKeys, existsKeys);

    for (let i = 0; i < needCreateKey.length; i++) {
      await this.prismaService.txClient().attachmentsTable.create({
        data: attachmentsMap[needCreateKey[i]],
      });
    }

    const toDeletes = needDeleteKey.map((key) => existsMap[key]);
    toDeletes.length && (await this.delete(toDeletes));
  }

  async delete(
    query: {
      tableId: string;
      recordId: string;
      fieldId: string;
      attachmentId?: string;
    }[]
  ) {
    await this.prismaService.attachmentsTable.deleteMany({
      where: { OR: query },
    });
  }

  async deleteFields(tableId: string, fieldIds: string[]) {
    await this.prismaService.attachmentsTable.deleteMany({
      where: { tableId, fieldId: { in: fieldIds } },
    });
  }

  async deleteTable(tableId: string) {
    await this.prismaService.attachmentsTable.deleteMany({
      where: { tableId },
    });
  }
}
