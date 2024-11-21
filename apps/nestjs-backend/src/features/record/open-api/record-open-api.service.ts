import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { IAttachmentCellValue, IAttachmentItem, IMakeOptional } from '@teable/core';
import { FieldKeyType, FieldType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { UploadType } from '@teable/openapi';
import type {
  IRecordHistoryItemVo,
  ICreateRecordsRo,
  ICreateRecordsVo,
  IGetRecordHistoryQuery,
  IRecord,
  IRecordHistoryVo,
  IRecordInsertOrderRo,
  IUpdateRecordRo,
  IUpdateRecordsRo,
} from '@teable/openapi';
import { forEach, keyBy, map } from 'lodash';
import { ClsService } from 'nestjs-cls';
import { bufferCount, concatMap, from, lastValueFrom, reduce } from 'rxjs';
import { IThresholdConfig, ThresholdConfig } from '../../../configs/threshold.config';
import { EventEmitterService } from '../../../event-emitter/event-emitter.service';
import { Events } from '../../../event-emitter/events';
import type { IClsStore } from '../../../types/cls';
import { AttachmentsStorageService } from '../../attachments/attachments-storage.service';
import { AttachmentsService } from '../../attachments/attachments.service';
import StorageAdapter from '../../attachments/plugins/adapter';
import { getFullStorageUrl } from '../../attachments/plugins/utils';
import { SystemFieldService } from '../../calculation/system-field.service';
import { CollaboratorService } from '../../collaborator/collaborator.service';
import { FieldConvertingService } from '../../field/field-calculate/field-converting.service';
import { createFieldInstanceByRaw } from '../../field/model/factory';
import { ViewOpenApiService } from '../../view/open-api/view-open-api.service';
import { ViewService } from '../../view/view.service';
import { RecordCalculateService } from '../record-calculate/record-calculate.service';
import type { IRecordInnerRo } from '../record.service';
import { RecordService } from '../record.service';
import { TypeCastAndValidate } from '../typecast.validate';

@Injectable()
export class RecordOpenApiService {
  constructor(
    private readonly recordCalculateService: RecordCalculateService,
    private readonly prismaService: PrismaService,
    private readonly recordService: RecordService,
    private readonly fieldConvertingService: FieldConvertingService,
    private readonly systemFieldService: SystemFieldService,
    private readonly attachmentsStorageService: AttachmentsStorageService,
    private readonly collaboratorService: CollaboratorService,
    private readonly viewService: ViewService,
    private readonly viewOpenApiService: ViewOpenApiService,
    private readonly eventEmitterService: EventEmitterService,
    private readonly attachmentsService: AttachmentsService,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig,
    private readonly cls: ClsService<IClsStore>
  ) {}

  async multipleCreateRecords(
    tableId: string,
    createRecordsRo: ICreateRecordsRo
  ): Promise<ICreateRecordsVo> {
    return await this.prismaService.$tx(
      async () => {
        return await this.createRecords(tableId, createRecordsRo);
      },
      {
        timeout: this.thresholdConfig.bigTransactionTimeout,
      }
    );
  }

  /**
   * create records without any ops, only typecast and sql
   * @param tableId
   * @param createRecordsRo
   */
  async createRecordsOnlySql(tableId: string, createRecordsRo: ICreateRecordsRo): Promise<void> {
    await this.prismaService.$tx(async () => {
      return await this.createPureRecords(tableId, createRecordsRo);
    });
  }

  private async getRecordOrderIndexes(
    tableId: string,
    orderRo: IRecordInsertOrderRo,
    recordCount: number
  ) {
    const dbTableName = await this.recordService.getDbTableName(tableId);

    const indexField = await this.viewService.getOrCreateViewIndexField(
      dbTableName,
      orderRo.viewId
    );
    let indexes: number[] = [];
    await this.viewOpenApiService.updateRecordOrdersInner({
      tableId,
      dbTableName,
      itemLength: recordCount,
      indexField,
      orderRo,
      update: async (result) => {
        indexes = result;
      },
    });

    return indexes;
  }

  private async appendRecordOrderIndexes(
    tableId: string,
    records: IMakeOptional<IRecordInnerRo, 'id'>[],
    order: IRecordInsertOrderRo | undefined
  ) {
    if (!order) {
      return records;
    }
    const indexes = order && (await this.getRecordOrderIndexes(tableId, order, records.length));
    return records.map((record, i) => ({
      ...record,
      order: indexes
        ? {
            [order.viewId]: indexes[i],
          }
        : undefined,
    }));
  }

  async createRecords(
    tableId: string,
    createRecordsRo: ICreateRecordsRo & {
      records: IMakeOptional<IRecordInnerRo, 'id'>[];
    }
  ): Promise<ICreateRecordsVo> {
    const { fieldKeyType = FieldKeyType.Name, records, typecast, order } = createRecordsRo;
    const chunkSize = this.thresholdConfig.calcChunkSize;
    const typecastRecords = await this.validateFieldsAndTypecast(
      tableId,
      records,
      fieldKeyType,
      typecast
    );

    const preparedRecords = await this.appendRecordOrderIndexes(tableId, typecastRecords, order);

    return await lastValueFrom(
      from(preparedRecords).pipe(
        bufferCount(chunkSize),
        concatMap((chunk) =>
          from(this.recordCalculateService.createRecords(tableId, chunk, fieldKeyType))
        ),
        reduce(
          (acc, result) => ({
            records: [...acc.records, ...result.records],
          }),
          { records: [] } as ICreateRecordsVo
        )
      )
    );
  }

  private async createPureRecords(
    tableId: string,
    createRecordsRo: ICreateRecordsRo
  ): Promise<void> {
    const { fieldKeyType = FieldKeyType.Name, records, typecast } = createRecordsRo;
    const typecastRecords = await this.validateFieldsAndTypecast(
      tableId,
      records,
      fieldKeyType,
      typecast
    );

    await this.recordService.createRecordsOnlySql(tableId, typecastRecords);
  }

  private async getEffectFieldInstances(
    tableId: string,
    recordsFields: Record<string, unknown>[],
    fieldKeyType: FieldKeyType = FieldKeyType.Name
  ) {
    const fieldIdsOrNamesSet = recordsFields.reduce<Set<string>>((acc, recordFields) => {
      const fieldIds = Object.keys(recordFields);
      forEach(fieldIds, (fieldId) => acc.add(fieldId));
      return acc;
    }, new Set());

    const usedFieldIdsOrNames = Array.from(fieldIdsOrNamesSet);

    const usedFields = await this.prismaService.txClient().field.findMany({
      where: {
        tableId,
        [fieldKeyType]: { in: usedFieldIdsOrNames },
        deletedTime: null,
      },
    });

    if (usedFields.length !== usedFieldIdsOrNames.length) {
      const usedSet = new Set(map(usedFields, fieldKeyType));
      const missedFields = usedFieldIdsOrNames.filter(
        (fieldIdOrName) => !usedSet.has(fieldIdOrName)
      );
      throw new NotFoundException(`Field ${fieldKeyType}: ${missedFields.join()} not found`);
    }
    return map(usedFields, createFieldInstanceByRaw);
  }

  async validateFieldsAndTypecast<
    T extends {
      fields: Record<string, unknown>;
    },
  >(
    tableId: string,
    records: T[],
    fieldKeyType: FieldKeyType = FieldKeyType.Name,
    typecast?: boolean
  ): Promise<T[]> {
    const recordsFields = map(records, 'fields');
    const effectFieldInstance = await this.getEffectFieldInstances(
      tableId,
      recordsFields,
      fieldKeyType
    );

    const newRecordsFields: Record<string, unknown>[] = recordsFields.map(() => ({}));
    for (const field of effectFieldInstance) {
      // skip computed field
      if (field.isComputed) {
        continue;
      }
      const typeCastAndValidate = new TypeCastAndValidate({
        services: {
          prismaService: this.prismaService,
          fieldConvertingService: this.fieldConvertingService,
          recordService: this.recordService,
          attachmentsStorageService: this.attachmentsStorageService,
          collaboratorService: this.collaboratorService,
        },
        field,
        tableId,
        typecast,
      });
      const fieldIdOrName = field[fieldKeyType];

      const cellValues = recordsFields.map((recordFields) => recordFields[fieldIdOrName]);

      const newCellValues = await typeCastAndValidate.typecastCellValuesWithField(cellValues);
      newRecordsFields.forEach((recordField, i) => {
        // do not generate undefined field key
        if (newCellValues[i] !== undefined) {
          recordField[fieldIdOrName] = newCellValues[i];
        }
      });
    }
    return records.map((record, i) => ({
      ...record,
      fields: newRecordsFields[i],
    }));
  }

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
    const { records, order, fieldKeyType, typecast } = updateRecordsRo;
    const orderIndexesBefore =
      order != null && windowId
        ? await this.recordService.getRecordIndexes(
            tableId,
            records.map((r) => r.id),
            order.viewId
          )
        : undefined;

    const cellContexts = await this.prismaService.$tx(async () => {
      if (order != null) {
        const { viewId, anchorId, position } = order;

        await this.viewOpenApiService.updateRecordOrders(tableId, viewId, {
          anchorId,
          position,
          recordIds: records.map((r) => r.id),
        });
      }

      // validate cellValue and typecast
      const typecastRecords = await this.validateFieldsAndTypecast(
        tableId,
        records,
        fieldKeyType,
        typecast
      );

      const preparedRecords = await this.systemFieldService.getModifiedSystemOpsMap(
        tableId,
        typecastRecords
      );

      return await this.recordCalculateService.calculateUpdatedRecord(
        tableId,
        fieldKeyType,
        preparedRecords
      );
    });

    const recordIds = records.map((r) => r.id);
    if (windowId) {
      const orderIndexesAfter =
        order && (await this.recordService.getRecordIndexes(tableId, recordIds, order.viewId));

      this.eventEmitterService.emitAsync(Events.OPERATION_RECORDS_UPDATE, {
        tableId,
        windowId,
        userId: this.cls.get('user.id'),
        recordIds,
        fieldIds: Object.keys(records[0]?.fields || {}),
        cellContexts,
        orderIndexesBefore,
        orderIndexesAfter,
      });
    }

    const snapshots = await this.prismaService.$tx(async () =>
      this.recordService.getSnapshotBulk(
        tableId,
        recordIds,
        undefined,
        updateRecordsRo.fieldKeyType
      )
    );

    return {
      records: snapshots.map((snapshot) => snapshot.data),
      cellContexts,
    };
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

    const snapshots = await this.recordService.getSnapshotBulk(
      tableId,
      [recordId],
      undefined,
      updateRecordRo.fieldKeyType
    );

    if (snapshots.length !== 1) {
      throw new Error('update record failed');
    }

    return snapshots[0].data;
  }

  async deleteRecord(tableId: string, recordId: string, windowId?: string) {
    const data = await this.deleteRecords(tableId, [recordId], windowId);
    return data.records[0];
  }

  async deleteRecords(tableId: string, recordIds: string[], windowId?: string) {
    const { records, orders } = await this.prismaService.$tx(async () => {
      const records = await this.recordService.getRecordsById(tableId, recordIds);
      await this.recordCalculateService.calculateDeletedRecord(tableId, recordIds);
      const orders = windowId
        ? await this.recordService.getRecordIndexes(tableId, recordIds)
        : undefined;
      await this.recordService.batchDeleteRecords(tableId, recordIds);
      return { records, orders };
    });

    if (windowId) {
      this.eventEmitterService.emitAsync(Events.OPERATION_RECORDS_DELETE, {
        windowId,
        tableId,
        userId: this.cls.get('user.id'),
        records: records.records.map((record, index) => ({
          ...record,
          order: orders?.[index],
        })),
      });
    }

    return records;
  }

  async getRecordHistory(
    tableId: string,
    recordId: string | undefined,
    query: IGetRecordHistoryQuery
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
        avatar: avatar && getFullStorageUrl(StorageAdapter.getBucket(UploadType.Avatar), avatar),
      };
    });

    return {
      historyList,
      userMap: keyBy(handledUserList, 'id'),
      nextCursor,
    };
  }

  private async getValidateAttachmentRecord(tableId: string, recordId: string, fieldId: string) {
    const field = await this.prismaService.field
      .findFirstOrThrow({
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

  async duplicateRecord(tableId: string, recordId: string, order: IRecordInsertOrderRo) {
    const query = { fieldKeyType: FieldKeyType.Id };
    const result = await this.recordService.getRecord(tableId, recordId, query);
    const records = { fields: result.fields };
    const createRecordsRo = {
      fieldKeyType: FieldKeyType.Id,
      order,
      records: [records],
    };
    return await this.prismaService.$tx(async () => this.createRecords(tableId, createRecordsRo));
  }
}
