import { BadRequestException, Injectable } from '@nestjs/common';
import type { ICreateRecordsRo, ICreateRecordsVo, IRecord } from '@teable-group/core';
import { FieldKeyType, generateRecordId, RecordOpBuilder, FieldType } from '@teable-group/core';
import { PrismaService } from '@teable-group/db-main-prisma';
import { isEmpty, keyBy } from 'lodash';
import { BatchService } from '../../calculation/batch.service';
import { FieldCalculationService } from '../../calculation/field-calculation.service';
import { LinkService } from '../../calculation/link.service';
import type { ICellContext } from '../../calculation/link.service';
import type { IOpsMap } from '../../calculation/reference.service';
import { ReferenceService } from '../../calculation/reference.service';
import { SystemFieldService } from '../../calculation/system-field.service';
import { formatChangesToOps } from '../../calculation/utils/changes';
import { composeMaps } from '../../calculation/utils/compose-maps';
import { RecordService } from '../record.service';

@Injectable()
export class RecordCalculateService {
  constructor(
    private readonly batchService: BatchService,
    private readonly prismaService: PrismaService,
    private readonly recordService: RecordService,
    private readonly linkService: LinkService,
    private readonly referenceService: ReferenceService,
    private readonly fieldCalculationService: FieldCalculationService,
    private readonly systemFieldService: SystemFieldService
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

    const opsMapByLink = cellChanges.length ? formatChangesToOps(cellChanges) : {};
    const composedOpsMap = composeMaps([opsMapOrigin, opsMapByLink]);
    const systemFieldOpsMap = await this.systemFieldService.getOpsMapBySystemField(composedOpsMap);

    // calculate by origin ops and link derivation
    const {
      opsMap: opsMapByCalculation,
      fieldMap,
      tableId2DbTableName,
    } = await this.referenceService.calculateOpsMap(composedOpsMap, derivate?.saveForeignKeyToDb);

    return {
      opsMap: composeMaps([opsMapOrigin, opsMapByLink, opsMapByCalculation, systemFieldOpsMap]),
      fieldMap,
      tableId2DbTableName,
    };
  }

  async calculateUpdatedRecord(
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

    // console.log('final:opsMap', JSON.stringify(opsMap, null, 2));

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

    await this.fieldCalculationService.calculateFieldsByRecordIds(tableId, recordIds);

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
}
