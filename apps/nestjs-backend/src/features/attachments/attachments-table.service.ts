import { Injectable } from '@nestjs/common';
import { FieldType } from '@teable/core';
import type { IAttachmentCellValue, IRecord } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { Prisma } from '@teable/db-main-prisma';
import { omit } from 'lodash';
import type { IChangeRecord } from '../../event-emitter/events';
import { AttachmentsTableQueueProcessor } from './attachments-table.processor';

@Injectable()
export class AttachmentsTableService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly attachmentsTableQueueProcessor: AttachmentsTableQueueProcessor
  ) {}

  private createUniqueKey(
    tableId: string,
    fieldId: string,
    recordId: string,
    attachmentId: string
  ) {
    return `${tableId}-${fieldId}-${recordId}-${attachmentId}`;
  }

  private async getAttachmentFields(tableId: string) {
    return await this.prismaService.txClient().field.findMany({
      where: { tableId, type: FieldType.Attachment, isLookup: null, deletedTime: null },
      select: { id: true },
    });
  }

  async createRecords(userId: string, tableId: string, records: IRecord[]) {
    const fieldRaws = await this.getAttachmentFields(tableId);
    const newAttachments: (Prisma.AttachmentsTableCreateInput & {
      attachment: {
        path: string;
        mimetype: string;
        width?: number;
        height?: number;
      };
    })[] = [];
    records.forEach((record) => {
      const { id: recordId, fields } = record;
      fieldRaws.forEach(({ id }) => {
        const attachments = fields[id] as IAttachmentCellValue;
        attachments?.forEach((attachment) => {
          newAttachments.push({
            tableId,
            recordId,
            name: attachment.name,
            fieldId: id,
            token: attachment.token,
            attachmentId: attachment.id,
            createdBy: userId,
            attachment: {
              path: attachment.path,
              mimetype: attachment.mimetype,
              width: attachment.width,
              height: attachment.height,
            },
          });
        });
      });
    });
    await this.prismaService.$tx(async (prisma) => {
      for (let i = 0; i < newAttachments.length; i++) {
        await prisma.attachmentsTable.create({ data: omit(newAttachments[i], 'attachment') });
        const { path, mimetype, width, height } = newAttachments[i].attachment;
        if (mimetype.startsWith('image/') && width && height) {
          await this.attachmentsTableQueueProcessor.queue.add(`crop_image_${tableId}`, {
            tableId,
            attachmentItem: {
              path,
              mimetype,
              height,
            },
          });
        }
      }
    });
  }

  async updateRecords(userId: string, tableId: string, records: IChangeRecord[]) {
    const fieldRaws = await this.getAttachmentFields(tableId);
    const newAttachments: (Prisma.AttachmentsTableCreateInput & {
      attachment: {
        path: string;
        mimetype: string;
        width?: number;
        height?: number;
      };
    })[] = [];
    const needDelete: {
      tableId: string;
      fieldId: string;
      recordId: string;
      attachmentId: string;
    }[] = [];
    records.forEach((record) => {
      const { id: recordId, fields } = record;
      fieldRaws.forEach(({ id: fieldId }) => {
        const { newValue, oldValue } = fields[fieldId] || {};
        const newAttachmentsValue = newValue as IAttachmentCellValue;
        const newAttachmentsMap = new Map<string, boolean>();
        const oldAttachmentsValue = oldValue as IAttachmentCellValue;
        const oldAttachmentsMap = new Map<string, boolean>();
        newAttachmentsValue?.forEach((attachment) => {
          newAttachmentsMap.set(
            this.createUniqueKey(tableId, fieldId, recordId, attachment.id),
            true
          );
        });
        oldAttachmentsValue?.forEach((attachment) => {
          oldAttachmentsMap.set(
            this.createUniqueKey(tableId, fieldId, recordId, attachment.id),
            true
          );
        });
        oldAttachmentsValue?.forEach((attachment) => {
          const uniqueKey = this.createUniqueKey(tableId, fieldId, recordId, attachment.id);
          if (newAttachmentsMap.has(uniqueKey)) {
            return;
          }
          needDelete.push({
            tableId,
            fieldId,
            recordId,
            attachmentId: attachment.id,
          });
        });
        newAttachmentsValue?.forEach((attachment) => {
          const uniqueKey = this.createUniqueKey(tableId, fieldId, recordId, attachment.id);
          if (oldAttachmentsMap.has(uniqueKey)) {
            return;
          } else {
            newAttachments.push({
              tableId,
              recordId,
              name: attachment.name,
              fieldId,
              token: attachment.token,
              attachmentId: attachment.id,
              createdBy: userId,
              attachment: {
                path: attachment.path,
                mimetype: attachment.mimetype,
                width: attachment.width,
                height: attachment.height,
              },
            });
          }
        });
      });
    });

    await this.prismaService.$tx(async (prisma) => {
      needDelete.length && (await this.delete(needDelete));
      for (let i = 0; i < newAttachments.length; i++) {
        await prisma.attachmentsTable.create({ data: omit(newAttachments[i], 'attachment') });
        const { path, mimetype, width, height } = newAttachments[i].attachment;
        if (mimetype.startsWith('image/') && width && height) {
          await this.attachmentsTableQueueProcessor.queue.add(`crop_image_${tableId}`, {
            tableId,
            attachmentItem: {
              path,
              mimetype,
              height,
            },
          });
        }
      }
    });
  }

  async delete(
    query: {
      tableId: string;
      recordId: string;
      fieldId: string;
      attachmentId?: string;
    }[]
  ) {
    if (!query.length) {
      return;
    }

    await this.prismaService.txClient().attachmentsTable.deleteMany({
      where: { OR: query },
    });
  }

  async deleteRecords(tableId: string, recordIds: string[]) {
    await this.prismaService.txClient().attachmentsTable.deleteMany({
      where: { tableId, recordId: { in: recordIds } },
    });
  }

  async deleteFields(tableId: string, fieldIds: string[]) {
    await this.prismaService.txClient().attachmentsTable.deleteMany({
      where: { tableId, fieldId: { in: fieldIds } },
    });
  }

  async deleteTable(tableId: string) {
    await this.prismaService.txClient().attachmentsTable.deleteMany({
      where: { tableId },
    });
  }
}
