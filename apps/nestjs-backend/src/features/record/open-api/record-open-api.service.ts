import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  IAttachmentCellValue,
  IAttachmentItem,
  IButtonFieldCellValue,
  IButtonFieldOptions,
  IMakeOptional,
} from '@teable/core';
import { FieldKeyType, FieldType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { ICreateRecordsRo } from '@teable/openapi';
import type {
  IRecordHistoryItemVo,
  ICreateRecordsVo,
  IGetRecordHistoryQuery,
  IRecord,
  IRecordHistoryVo,
  IRecordInsertOrderRo,
  IUpdateRecordRo,
  IUpdateRecordsRo,
} from '@teable/openapi';
import { keyBy, pick } from 'lodash';
import { IThresholdConfig, ThresholdConfig } from '../../../configs/threshold.config';
import { retryOnDeadlock } from '../../../utils/retry-decorator';
import { AttachmentsService } from '../../attachments/attachments.service';
import { getPublicFullStorageUrl } from '../../attachments/plugins/utils';
import { createFieldInstanceByRaw } from '../../field/model/factory';
import { RecordModifyService } from '../record-modify/record-modify.service';
import { RecordModifySharedService } from '../record-modify/record-modify.shared.service';
import type { IRecordInnerRo } from '../record.service';
import { RecordService } from '../record.service';

@Injectable()
export class RecordOpenApiService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly recordService: RecordService,
    private readonly attachmentsService: AttachmentsService,
    private readonly recordModifyService: RecordModifyService,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig,
    private readonly recordModifySharedService: RecordModifySharedService
  ) {}

  @retryOnDeadlock()
  async multipleCreateRecords(
    tableId: string,
    createRecordsRo: ICreateRecordsRo,
    ignoreMissingFields: boolean = false
  ): Promise<ICreateRecordsVo> {
    return await this.prismaService.$tx(
      async () =>
        this.recordModifyService.multipleCreateRecords(
          tableId,
          createRecordsRo,
          ignoreMissingFields
        ),
      { timeout: this.thresholdConfig.bigTransactionTimeout }
    );
  }

  /**
   * create records without any ops, only typecast and sql
   * @param tableId
   * @param createRecordsRo
   */
  async createRecordsOnlySql(tableId: string, createRecordsRo: ICreateRecordsRo): Promise<void> {
    await this.prismaService.$tx(async () => {
      return await this.recordModifyService.createRecordsOnlySql(tableId, createRecordsRo);
    });
  }

  async createRecords(
    tableId: string,
    createRecordsRo: ICreateRecordsRo & { records: IMakeOptional<IRecordInnerRo, 'id'>[] },
    ignoreMissingFields: boolean = false
  ): Promise<ICreateRecordsVo> {
    return this.recordModifyService.multipleCreateRecords(
      tableId,
      createRecordsRo,
      ignoreMissingFields
    );
  }

  @retryOnDeadlock()
  async updateRecords(
    tableId: string,
    updateRecordsRo: IUpdateRecordsRo & {
      records: {
        id: string;
        fields: Record<string, unknown>;
        order?: Record<string, number>;
      }[];
    },
    windowId?: string
  ) {
    return await this.recordModifyService.updateRecords(tableId, updateRecordsRo, windowId);
  }

  async simpleUpdateRecords(
    tableId: string,
    updateRecordsRo: IUpdateRecordsRo & {
      records: {
        id: string;
        fields: Record<string, unknown>;
        order?: Record<string, number>;
      }[];
    }
  ) {
    return await this.recordModifyService.simpleUpdateRecords(tableId, updateRecordsRo);
  }

  async updateRecord(
    tableId: string,
    recordId: string,
    updateRecordRo: IUpdateRecordRo,
    windowId?: string
  ): Promise<IRecord> {
    await this.updateRecords(
      tableId,
      {
        ...updateRecordRo,
        records: [{ id: recordId, fields: updateRecordRo.record.fields }],
      },
      windowId
    );

    const snapshots = await this.recordService.getSnapshotBulkWithPermission(
      tableId,
      [recordId],
      undefined,
      updateRecordRo.fieldKeyType || FieldKeyType.Name
    );

    if (snapshots.length !== 1) {
      throw new Error('update record failed');
    }

    return snapshots[0].data;
  }

  async deleteRecord(tableId: string, recordId: string, windowId?: string) {
    return this.recordModifyService.deleteRecord(tableId, recordId, windowId);
  }

  async deleteRecords(tableId: string, recordIds: string[], windowId?: string) {
    return this.recordModifyService.deleteRecords(tableId, recordIds, windowId);
  }

  async getRecordHistory(
    tableId: string,
    recordId: string | undefined,
    query: IGetRecordHistoryQuery,
    projectionIds?: string[]
  ): Promise<IRecordHistoryVo> {
    const { cursor, startDate, endDate } = query;
    const limit = 20;

    const dateFilter: { [key: string]: Date } = {};
    if (startDate) {
      dateFilter['gte'] = new Date(startDate);
    }
    if (endDate) {
      dateFilter['lte'] = new Date(endDate);
    }

    const list = await this.prismaService.recordHistory.findMany({
      where: {
        tableId,
        ...(recordId ? { recordId } : {}),
        ...(Object.keys(dateFilter).length > 0 ? { createdTime: dateFilter } : {}),
        ...(projectionIds?.length ? { fieldId: { in: projectionIds } } : {}),
      },
      select: {
        id: true,
        recordId: true,
        fieldId: true,
        before: true,
        after: true,
        createdTime: true,
        createdBy: true,
      },
      take: limit + 1,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: {
        createdTime: 'desc',
      },
    });

    let nextCursor: typeof cursor | undefined = undefined;

    if (list.length > limit) {
      const nextItem = list.pop();
      nextCursor = nextItem?.id;
    }

    const createdBySet: Set<string> = new Set();
    const historyList: IRecordHistoryItemVo[] = [];

    for (const item of list) {
      const { id, recordId, fieldId, before, after, createdTime, createdBy } = item;

      createdBySet.add(createdBy);
      const beforeObj = JSON.parse(before as string);
      const afterObj = JSON.parse(after as string);
      const { meta: beforeMeta, data: beforeData } = beforeObj as IRecordHistoryItemVo['before'];
      const { meta: afterMeta, data: afterData } = afterObj as IRecordHistoryItemVo['after'];
      const { type: beforeType } = beforeMeta;
      const { type: afterType } = afterMeta;

      if (beforeType === FieldType.Attachment) {
        beforeObj.data = await this.recordService.getAttachmentPresignedCellValue(
          beforeData as IAttachmentCellValue
        );
      }

      if (afterType === FieldType.Attachment) {
        afterObj.data = await this.recordService.getAttachmentPresignedCellValue(
          afterData as IAttachmentCellValue
        );
      }

      historyList.push({
        id,
        tableId,
        recordId,
        fieldId,
        before: beforeObj,
        after: afterObj,
        createdTime: createdTime.toISOString(),
        createdBy,
      });
    }

    const userList = await this.prismaService.user.findMany({
      where: {
        id: {
          in: Array.from(createdBySet),
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
        avatar: true,
      },
    });

    const handledUserList = userList.map((user) => {
      const { avatar } = user;
      return {
        ...user,
        avatar: avatar && getPublicFullStorageUrl(avatar),
      };
    });

    return {
      historyList,
      userMap: keyBy(handledUserList, 'id'),
      nextCursor,
    };
  }

  private async getValidateAttachmentRecord(tableId: string, recordId: string, fieldId: string) {
    const field = await this.prismaService
      .txClient()
      .field.findFirstOrThrow({
        where: {
          id: fieldId,
          deletedTime: null,
        },
        select: {
          id: true,
          type: true,
          isComputed: true,
        },
      })
      .catch(() => {
        throw new NotFoundException(`Field ${fieldId} not found`);
      });

    if (field.type !== FieldType.Attachment) {
      throw new BadRequestException('Field is not an attachment');
    }

    if (field.isComputed) {
      throw new BadRequestException('Field is computed');
    }

    const recordData = await this.recordService.getRecordsById(tableId, [recordId]);
    const record = recordData.records[0];
    if (!record) {
      throw new NotFoundException(`Record ${recordId} not found`);
    }
    return record;
  }

  async uploadAttachment(
    tableId: string,
    recordId: string,
    fieldId: string,
    file?: Express.Multer.File,
    fileUrl?: string
  ) {
    if (!file && !fileUrl) {
      throw new BadRequestException('No file or URL provided');
    }

    const record = await this.getValidateAttachmentRecord(tableId, recordId, fieldId);

    const attachmentItem = file
      ? await this.attachmentsService.uploadFile(file)
      : await this.attachmentsService.uploadFromUrl(fileUrl as string);

    // Update the cell value
    const updateRecordRo: IUpdateRecordRo = {
      fieldKeyType: FieldKeyType.Id,
      record: {
        fields: {
          [fieldId]: ((record.fields[fieldId] || []) as IAttachmentItem[]).concat(attachmentItem),
        },
      },
    };

    return await this.updateRecord(tableId, recordId, updateRecordRo);
  }

  async duplicateRecord(
    tableId: string,
    recordId: string,
    order: IRecordInsertOrderRo,
    projection?: string[]
  ) {
    const query = { fieldKeyType: FieldKeyType.Id, projection };
    const result = await this.recordService.getRecord(tableId, recordId, query);
    const records = { fields: result.fields };
    const createRecordsRo = {
      fieldKeyType: FieldKeyType.Id,
      order,
      records: [records],
    };
    return await this.prismaService
      .$tx(async () => this.createRecords(tableId, createRecordsRo))
      .then((res) => {
        return res.records[0];
      });
  }

  async buttonClick(tableId: string, recordId: string, fieldId: string) {
    const fieldRaw = await this.prismaService.txClient().field.findFirstOrThrow({
      where: {
        id: fieldId,
        type: FieldType.Button,
        deletedTime: null,
      },
    });

    const fieldInstance = createFieldInstanceByRaw(fieldRaw);
    const options = fieldInstance.options as IButtonFieldOptions;
    const isActive = options.workflow && options.workflow.id && options.workflow.isActive;
    if (!isActive) {
      throw new BadRequestException(
        `Button field's workflow ${options.workflow?.id} is not active`
      );
    }

    const maxCount = options.maxCount || 0;
    const record = await this.recordService.getRecord(tableId, recordId, {
      fieldKeyType: FieldKeyType.Id,
    });

    const fieldValue = record.fields[fieldId] as IButtonFieldCellValue;
    const count = fieldValue?.count || 0;
    if (maxCount > 0 && count >= maxCount) {
      throw new BadRequestException(`Button click count ${count} reached max count ${maxCount}`);
    }
    const updatedRecord: IRecord = await this.updateRecord(tableId, recordId, {
      record: {
        fields: { [fieldId]: { count: count + 1 } },
      },
      fieldKeyType: FieldKeyType.Id,
    });
    updatedRecord.fields = pick(updatedRecord.fields, [fieldId]);

    return {
      tableId,
      fieldId,
      record: updatedRecord,
    };
  }

  async resetButton(tableId: string, recordId: string, fieldId: string) {
    const fieldRaw = await this.prismaService.txClient().field.findFirstOrThrow({
      where: {
        id: fieldId,
        type: FieldType.Button,
        deletedTime: null,
      },
    });

    const fieldInstance = createFieldInstanceByRaw(fieldRaw);
    const fieldOptions = fieldInstance.options as IButtonFieldOptions;
    if (!fieldOptions.resetCount) {
      throw new BadRequestException('Button field does not support reset');
    }

    return await this.updateRecord(tableId, recordId, {
      fieldKeyType: FieldKeyType.Id,
      record: {
        fields: {
          [fieldId]: null,
        },
      },
    });
  }

  public validateFieldsAndTypecast<
    T extends {
      fields: Record<string, unknown>;
    },
  >(
    tableId: string,
    records: T[],
    fieldKeyType: FieldKeyType = FieldKeyType.Name,
    typecast: boolean = false,
    ignoreMissingFields: boolean = false
  ) {
    return this.recordModifySharedService.validateFieldsAndTypecast(
      tableId,
      records,
      fieldKeyType,
      typecast,
      ignoreMissingFields
    );
  }
}
