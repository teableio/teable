import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  ICreateRecordsRo,
  ICreateRecordsVo,
  IRecord,
  IUpdateRecordByIndexRo,
  IUpdateRecordRo,
  IUpdateRecordsRo,
} from '@teable-group/core';
import { FieldKeyType, FieldType } from '@teable-group/core';
import { PrismaService } from '@teable-group/db-main-prisma';
import { forEach, map } from 'lodash';
import { FieldConvertingService } from '../../field/field-calculate/field-converting.service';
import { createFieldInstanceByRaw } from '../../field/model/factory';
import { RecordCalculateService } from '../record-calculate/record-calculate.service';
import { RecordService } from '../record.service';
import { TypeCastAndValidate } from '../typecast.validate';

@Injectable()
export class RecordOpenApiService {
  constructor(
    private readonly recordCalculateService: RecordCalculateService,
    private readonly prismaService: PrismaService,
    private readonly recordService: RecordService,
    private readonly fieldConvertingService: FieldConvertingService
  ) {}

  async multipleCreateRecords(
    tableId: string,
    createRecordsRo: ICreateRecordsRo
  ): Promise<ICreateRecordsVo> {
    return await this.prismaService.$tx(async () => {
      return await this.createRecords(
        tableId,
        createRecordsRo.records,
        createRecordsRo.fieldKeyType
      );
    });
  }

  async createRecords(
    tableId: string,
    recordsRo: { id?: string; fields: Record<string, unknown> }[],
    fieldKeyType: FieldKeyType = FieldKeyType.Name
  ): Promise<ICreateRecordsVo> {
    return await this.recordCalculateService.createRecords(tableId, recordsRo, fieldKeyType);
  }

  async updateRecords(tableId: string, updateRecordsRo: IUpdateRecordsRo) {
    return await this.prismaService.$tx(async () => {
      // validate cellValue and typecast
      const typecastRecords = await this.validateFieldsAndTypecast(
        tableId,
        map(updateRecordsRo.records, 'fields'),
        updateRecordsRo.fieldKeyType,
        true
      );
      await this.recordCalculateService.calculateUpdatedRecord(
        tableId,
        updateRecordsRo.fieldKeyType,
        updateRecordsRo.records.map(({ id }, index) => ({
          id,
          fields: typecastRecords[index],
        }))
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
      },
    });

    if (usedFields.length !== usedFieldIdsOrNames.length) {
      throw new BadRequestException('some fields not found');
    }
    return map(usedFields, createFieldInstanceByRaw);
  }

  async validateFieldsAndTypecast(
    tableId: string,
    recordsFields: Record<string, unknown>[],
    fieldKeyType: FieldKeyType = FieldKeyType.Name,
    typecast?: boolean
  ) {
    const effectFieldInstance = await this.getEffectFieldInstances(
      tableId,
      recordsFields,
      fieldKeyType
    );
    let newRecordsFields: Record<string, unknown>[] = recordsFields;
    for (const field of effectFieldInstance) {
      const typeCastAndValidate = new TypeCastAndValidate({
        services: {
          prismaService: this.prismaService,
          fieldConvertingService: this.fieldConvertingService,
          recordService: this.recordService,
        },
        field,
        tableId,
        typecast,
      });

      newRecordsFields = await typeCastAndValidate.typecastRecordsWithField(
        recordsFields,
        fieldKeyType
      );
    }
    return newRecordsFields;
  }

  async updateRecordById(
    tableId: string,
    recordId: string,
    updateRecordRo: IUpdateRecordRo
  ): Promise<IRecord> {
    return await this.prismaService.$tx(async () => {
      const { fieldKeyType = FieldKeyType.Name, record } = updateRecordRo;

      await this.recordCalculateService.calculateUpdatedRecord(tableId, fieldKeyType, [
        { id: recordId, fields: record.fields },
      ]);

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

  async updateRecordByIndex(tableId: string, updateRecordRoByIndexRo: IUpdateRecordByIndexRo) {
    const { viewId, index, ...updateRecordRo } = updateRecordRoByIndexRo;
    const recordId = await this.recordService.getRecordIdByIndex(tableId, viewId, index);

    return await this.updateRecordById(tableId, recordId, updateRecordRo);
  }

  async deleteRecord(tableId: string, recordId: string) {
    return this.deleteRecords(tableId, [recordId]);
  }

  async deleteRecords(tableId: string, recordIds: string[]) {
    return await this.prismaService.$tx(async (prisma) => {
      const linkFieldRaws = await prisma.field.findMany({
        where: {
          tableId,
          type: FieldType.Link,
          deletedTime: null,
          isLookup: null,
        },
        select: { id: true },
      });

      // reset link fields to null to clean relational data
      const recordFields = linkFieldRaws.reduce<{ [fieldId: string]: null }>((pre, cur) => {
        pre[cur.id] = null;
        return pre;
      }, {});

      await this.recordCalculateService.calculateUpdatedRecord(
        tableId,
        FieldKeyType.Id,
        recordIds.map((id) => ({
          id,
          fields: recordFields,
        }))
      );

      await this.recordService.batchDeleteRecords(tableId, recordIds);
    });
  }
}
