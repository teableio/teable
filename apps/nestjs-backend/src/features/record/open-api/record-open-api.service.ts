import { Injectable, NotFoundException } from '@nestjs/common';
import type { IAttachmentCellValue } from '@teable/core';
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
import { AttachmentsStorageService } from '../../attachments/attachments-storage.service';
import StorageAdapter from '../../attachments/plugins/adapter';
import { getFullStorageUrl } from '../../attachments/plugins/utils';
import { CollaboratorService } from '../../collaborator/collaborator.service';
import { FieldConvertingService } from '../../field/field-calculate/field-converting.service';
import { createFieldInstanceByRaw } from '../../field/model/factory';
import { ViewOpenApiService } from '../../view/open-api/view-open-api.service';
import { ViewService } from '../../view/view.service';
import { RecordCalculateService } from '../record-calculate/record-calculate.service';
import { RecordService } from '../record.service';
import { TypeCastAndValidate } from '../typecast.validate';

@Injectable()
export class RecordOpenApiService {
  constructor(
    private readonly recordCalculateService: RecordCalculateService,
    private readonly prismaService: PrismaService,
    private readonly recordService: RecordService,
    private readonly fieldConvertingService: FieldConvertingService,
    private readonly attachmentsStorageService: AttachmentsStorageService,
    private readonly collaboratorService: CollaboratorService,
    private readonly viewService: ViewService,
    private readonly viewOpenApiService: ViewOpenApiService
  ) {}

  async multipleCreateRecords(
    tableId: string,
    createRecordsRo: ICreateRecordsRo
  ): Promise<ICreateRecordsVo> {
    return await this.prismaService.$tx(async () => {
      return await this.createRecords(tableId, createRecordsRo);
    });
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

  async createRecords(
    tableId: string,
    createRecordsRo: ICreateRecordsRo & {
      records: {
        fields: Record<string, unknown>;
        createdBy?: string;
        lastModifiedBy?: string;
        createdTime?: string;
        lastModifiedTime?: string;
        autoNumber?: number;
      }[];
    }
  ): Promise<ICreateRecordsVo> {
    const { fieldKeyType = FieldKeyType.Name, records, typecast, order } = createRecordsRo;

    const typecastRecords = await this.validateFieldsAndTypecast(
      tableId,
      records,
      fieldKeyType,
      typecast
    );

    const indexes = order && (await this.getRecordOrderIndexes(tableId, order, records.length));
    const orderIndex = indexes ? { viewId: order.viewId, indexes } : undefined;

    return await this.recordCalculateService.createRecords(
      tableId,
      typecastRecords,
      fieldKeyType,
      orderIndex
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

  async updateRecords(tableId: string, updateRecordsRo: IUpdateRecordsRo): Promise<IRecord[]> {
    return await this.prismaService.$tx(async () => {
      const { order, records } = updateRecordsRo;
      const recordIds = records.map((record) => record.id);
      if (order != null) {
        const { viewId, anchorId, position } = order;
        await this.viewOpenApiService.updateRecordOrders(tableId, viewId, {
          anchorId,
          position,
          recordIds,
        });
      }
      // validate cellValue and typecast
      const typecastRecords = await this.validateFieldsAndTypecast(
        tableId,
        updateRecordsRo.records,
        updateRecordsRo.fieldKeyType,
        updateRecordsRo.typecast
      );

      await this.recordCalculateService.calculateUpdatedRecord(
        tableId,
        updateRecordsRo.fieldKeyType,
        typecastRecords
      );

      const snapshots = await this.recordService.getSnapshotBulk(
        tableId,
        recordIds,
        undefined,
        updateRecordsRo.fieldKeyType
      );

      return snapshots.map((snapshot) => snapshot.data);
    });
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

  async updateRecord(
    tableId: string,
    recordId: string,
    updateRecordRo: IUpdateRecordRo
  ): Promise<IRecord> {
    return await this.prismaService.$tx(async () => {
      const { order, ...recordRo } = updateRecordRo;
      if (order != null) {
        const { viewId, anchorId, position } = order;
        await this.viewOpenApiService.updateRecordOrders(tableId, viewId, {
          anchorId,
          position,
          recordIds: [recordId],
        });
      }

      const { fieldKeyType = FieldKeyType.Name, typecast, record } = recordRo;

      const typecastRecords = await this.validateFieldsAndTypecast(
        tableId,
        [{ id: recordId, fields: record.fields }],
        fieldKeyType,
        typecast
      );

      await this.recordCalculateService.calculateUpdatedRecord(
        tableId,
        fieldKeyType,
        typecastRecords
      );

      // return record result
      const snapshots = await this.recordService.getSnapshotBulk(
        tableId,
        [recordId],
        undefined,
        fieldKeyType
      );

      if (snapshots.length !== 1) {
        throw new Error('update record failed');
      }
      return snapshots[0].data;
    });
  }

  async deleteRecord(tableId: string, recordId: string) {
    return this.deleteRecords(tableId, [recordId]);
  }

  async deleteRecords(tableId: string, recordIds: string[]) {
    return await this.prismaService.$tx(async () => {
      await this.recordCalculateService.calculateDeletedRecord(tableId, recordIds);

      await this.recordService.batchDeleteRecords(tableId, recordIds);
    });
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
}
