import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  ICreateRecordsRo,
  ICreateRecordsVo,
  IRecord,
  IUpdateRecordByIndexRo,
  IUpdateRecordRo,
  IUpdateRecordsRo,
} from '@teable-group/core';
import { FieldKeyType, generateRecordId, RecordOpBuilder, FieldType } from '@teable-group/core';
import { PrismaService } from '@teable-group/db-main-prisma';
import { isEmpty, keyBy } from 'lodash';
import { BatchService } from '../../calculation/batch.service';
import { FieldCalculationService } from '../../calculation/field-calculation.service';
import { LinkService } from '../../calculation/link.service';
import type { ICellContext } from '../../calculation/link.service';
import type { IOpsMap } from '../../calculation/reference.service';
import { ReferenceService } from '../../calculation/reference.service';
import { formatChangesToOps } from '../../calculation/utils/changes';
import { composeMaps } from '../../calculation/utils/compose-maps';
import { RecordService } from '../record.service';

@Injectable()
export class RecordOpenApiService {
  constructor(
    private readonly batchService: BatchService,
    private readonly prismaService: PrismaService,
    private readonly recordService: RecordService,
    private readonly linkService: LinkService,
    private readonly referenceService: ReferenceService,
    private readonly fieldCalculationService: FieldCalculationService
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

  private async generateCellContexts(
    tableId: string,
    fieldKeyType: FieldKeyType,
    records: { id: string; fields: { [fieldNameOrId: string]: unknown } }[],
    isNewRecord?: boolean
  ) {
    const fieldKeys = Array.from(
      records.reduce<Set<string>>((acc, record) => {
        Object.keys(record.fields).forEach((fieldNameOrId) => acc.add(fieldNameOrId));
        return acc;
      }, new Set())
    );

    const fieldRaws = await this.prismaService.txClient().field.findMany({
      where: { tableId, [fieldKeyType]: { in: fieldKeys } },
      select: { id: true, name: true },
    });
    const fieldIdMap = keyBy(fieldRaws, fieldKeyType);

    const cellContexts: ICellContext[] = [];

    let oldRecordsMap: Record<string, IRecord> = {};
    if (!isNewRecord) {
      const oldRecords = (
        await this.recordService.getSnapshotBulk(
          tableId,
          records.map((r) => r.id)
        )
      ).map((s) => s.data);
      oldRecordsMap = keyBy(oldRecords, 'id');
    }

    for (const record of records) {
      Object.entries(record.fields).forEach(([fieldNameOrId, value]) => {
        const fieldId = fieldIdMap[fieldNameOrId].id;
        const oldCellValue = isNewRecord ? null : oldRecordsMap[record.id].fields[fieldId];
        cellContexts.push({
          recordId: record.id,
          fieldId,
          newValue: value,
          oldValue: oldCellValue,
        });
      });
    }
    return cellContexts;
  }

  private async getRecordUpdateDerivation(
    tableId: string,
    opsMapOrigin: IOpsMap,
    opContexts: ICellContext[]
  ) {
    const derivate = await this.linkService.getDerivateByLink(tableId, opContexts);

    const cellChanges = derivate?.cellChanges || [];
    const fkRecordMap = derivate?.fkRecordMap || {};

    const opsMapByLink = cellChanges.length ? formatChangesToOps(cellChanges) : {};
    // calculate by origin ops and link derivation
    const {
      opsMap: opsMapByCalculation,
      fieldMap,
      tableId2DbTableName,
    } = await this.referenceService.calculateOpsMap(
      composeMaps([opsMapOrigin, opsMapByLink]),
      fkRecordMap
    );

    return {
      opsMap: composeMaps([opsMapOrigin, opsMapByLink, opsMapByCalculation]),
      fieldMap,
      tableId2DbTableName,
    };
  }

  private async calculateComputedFields(tableId: string, recordIds: string[]) {
    const fieldRaws = await this.prismaService.field.findMany({
      where: { OR: [{ tableId, isComputed: true, deletedTime: null }] },
      select: { id: true },
    });

    const computedFieldIds = fieldRaws.map((fieldRaw) => fieldRaw.id);

    // calculate by origin ops and link derivation
    const result = await this.fieldCalculationService.getChangedOpsMap(
      tableId,
      computedFieldIds,
      recordIds
    );

    if (result) {
      const { opsMap, fieldMap, tableId2DbTableName } = result;

      await this.batchService.updateRecords(opsMap, fieldMap, tableId2DbTableName);
    }
  }

  private async calculateUpdatedRecord(
    tableId: string,
    fieldKeyType: FieldKeyType = FieldKeyType.Name,
    records: { id: string; fields: { [fieldNameOrId: string]: unknown } }[],
    isNewRecord?: boolean
  ) {
    // 1. generate Op by origin submit
    const opsContexts = await this.generateCellContexts(
      tableId,
      fieldKeyType,
      records,
      isNewRecord
    );

    const opsMapOrigin = formatChangesToOps(
      opsContexts.map((data) => {
        return {
          tableId,
          recordId: data.recordId,
          fieldId: data.fieldId,
          newValue: data.newValue,
          oldValue: data.oldValue,
        };
      })
    );

    // 2. get cell changes by derivation
    const { opsMap, fieldMap, tableId2DbTableName } = await this.getRecordUpdateDerivation(
      tableId,
      opsMapOrigin,
      opsContexts
    );

    // 3. save all ops
    if (!isEmpty(opsMap)) {
      await this.batchService.updateRecords(opsMap, fieldMap, tableId2DbTableName);
    }
  }

  private async appendDefaultValue(
    tableId: string,
    records: { id: string; fields: { [fieldNameOrId: string]: unknown } }[],
    fieldKeyType: FieldKeyType
  ) {
    const fieldRaws = await this.prismaService.txClient().field.findMany({
      where: { tableId, deletedTime: null },
      select: { id: true, name: true, type: true, options: true },
    });

    return records.map((record) => {
      const fields: { [fieldIdOrName: string]: unknown } = { ...record.fields };
      for (const fieldRaw of fieldRaws) {
        const { type, options } = fieldRaw;
        if (options == null) continue;
        const { defaultValue } = JSON.parse(options) || {};
        if (defaultValue == null) continue;
        const fieldIdOrName = fieldRaw[fieldKeyType];
        if (fields[fieldIdOrName] != null) continue;
        fields[fieldIdOrName] = this.getDefaultValue(type as FieldType, defaultValue);
      }

      return {
        ...record,
        fields,
      };
    });
  }

  private getDefaultValue(type: FieldType, defaultValue: unknown) {
    if (type === FieldType.Date && defaultValue === 'now') {
      return new Date().toISOString();
    }
    return defaultValue;
  }

  async createRecords(
    tableId: string,
    recordsRo: { id?: string; fields: Record<string, unknown> }[],
    fieldKeyType: FieldKeyType = FieldKeyType.Name
  ): Promise<ICreateRecordsVo> {
    if (recordsRo.length === 0) {
      throw new BadRequestException('Create records is empty');
    }
    const emptyRecords = recordsRo.map((record) => {
      const recordId = record.id || generateRecordId();
      return RecordOpBuilder.creator.build({ id: recordId, fields: {}, recordOrder: {} });
    });

    await this.recordService.batchCreateRecords(tableId, emptyRecords);

    // submit auto fill changes
    const plainRecords = await this.appendDefaultValue(
      tableId,
      recordsRo.map((s, i) => ({ id: emptyRecords[i].id, fields: s.fields })),
      fieldKeyType
    );

    const recordIds = plainRecords.map((r) => r.id);

    await this.calculateUpdatedRecord(tableId, fieldKeyType, plainRecords, true);

    await this.calculateComputedFields(tableId, recordIds);

    const snapshots = await this.recordService.getSnapshotBulk(
      tableId,
      recordIds,
      undefined,
      fieldKeyType
    );

    return {
      records: snapshots.map((snapshot) => snapshot.data),
    };
  }

  async updateRecords(tableId: string, updateRecordsRo: IUpdateRecordsRo) {
    return await this.prismaService.$tx(async () => {
      await this.calculateUpdatedRecord(
        tableId,
        updateRecordsRo.fieldKeyType,
        updateRecordsRo.records
      );
    });
  }

  async updateRecordById(
    tableId: string,
    recordId: string,
    updateRecordRo: IUpdateRecordRo
  ): Promise<IRecord> {
    return await this.prismaService.$tx(async () => {
      const { fieldKeyType = FieldKeyType.Name, record } = updateRecordRo;

      await this.calculateUpdatedRecord(tableId, fieldKeyType, [
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

      await this.calculateUpdatedRecord(
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
