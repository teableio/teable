import { Injectable, NotFoundException } from '@nestjs/common';
import { FieldKeyType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  ICreateRecordsRo,
  ICreateRecordsVo,
  IRecord,
  IRecordInsertOrderRo,
  IUpdateRecordRo,
  IUpdateRecordsRo,
} from '@teable/openapi';
import { forEach, map } from 'lodash';
import { AttachmentsStorageService } from '../../attachments/attachments-storage.service';
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
    createRecordsRo: ICreateRecordsRo
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

  async updateRecords(tableId: string, updateRecordsRo: IUpdateRecordsRo) {
    return await this.prismaService.$tx(async () => {
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
}
