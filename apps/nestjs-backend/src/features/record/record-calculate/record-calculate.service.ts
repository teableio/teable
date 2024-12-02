import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { IMakeOptional, IUserFieldOptions } from '@teable/core';
import { FieldKeyType, generateRecordId, FieldType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { ICreateRecordsRo, ICreateRecordsVo, IRecord } from '@teable/openapi';
import { keyBy, uniq } from 'lodash';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../../types/cls';
import { BatchService } from '../../calculation/batch.service';
import { FieldCalculationService } from '../../calculation/field-calculation.service';
import { LinkService } from '../../calculation/link.service';
import { ReferenceService } from '../../calculation/reference.service';
import type { ICellContext } from '../../calculation/utils/changes';
import { formatChangesToOps } from '../../calculation/utils/changes';
import type { IOpsMap } from '../../calculation/utils/compose-maps';
import { composeOpMaps } from '../../calculation/utils/compose-maps';
import type { IRecordInnerRo } from '../record.service';
import { RecordService } from '../record.service';
import type { IFieldRaws } from '../type';

@Injectable()
export class RecordCalculateService {
  constructor(
    private readonly batchService: BatchService,
    private readonly prismaService: PrismaService,
    private readonly recordService: RecordService,
    private readonly linkService: LinkService,
    private readonly referenceService: ReferenceService,
    private readonly fieldCalculationService: FieldCalculationService,
    private readonly clsService: ClsService<IClsStore>
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
        if (!fieldIdMap[fieldNameOrId]) {
          throw new NotFoundException(`Field ${fieldNameOrId} not found`);
        }
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

  private async calculate(tableId: string, opsMapOrigin: IOpsMap, opContexts: ICellContext[]) {
    const derivate = await this.linkService.getDerivateByLink(tableId, opContexts);

    const cellChanges = derivate?.cellChanges || [];

    const opsMapByLink = cellChanges.length ? formatChangesToOps(cellChanges) : {};
    const manualOpsMap = composeOpMaps([opsMapOrigin, opsMapByLink]);

    await this.batchService.updateRecords(manualOpsMap);

    await this.referenceService.calculateOpsMap(manualOpsMap, derivate?.fkRecordMap);
  }

  async calculateDeletedRecord(tableId: string, recordIds: string[]) {
    const cellContextsByTableId = await this.linkService.getDeleteRecordUpdateContext(
      tableId,
      recordIds
    );

    // console.log('calculateDeletedRecord', tableId, recordIds);

    for (const effectedTableId in cellContextsByTableId) {
      const cellContexts = cellContextsByTableId[effectedTableId];
      const opsMapOrigin = formatChangesToOps(
        cellContexts.map((data) => {
          return {
            tableId: effectedTableId,
            recordId: data.recordId,
            fieldId: data.fieldId,
            newValue: data.newValue,
            oldValue: data.oldValue,
          };
        })
      );

      await this.calculate(effectedTableId, opsMapOrigin, cellContexts);
    }
  }

  async calculateUpdatedRecord(
    tableId: string,
    fieldKeyType: FieldKeyType = FieldKeyType.Name,
    records: { id: string; fields: { [fieldNameOrId: string]: unknown } }[],
    isNewRecord?: boolean
  ) {
    // 1. generate Op by origin submit
    const originCellContexts = await this.generateCellContexts(
      tableId,
      fieldKeyType,
      records,
      isNewRecord
    );

    const opsMapOrigin = formatChangesToOps(
      originCellContexts.map((data) => {
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
    await this.calculate(tableId, opsMapOrigin, originCellContexts);

    return originCellContexts;
  }

  private async appendDefaultValue(
    records: { id: string; fields: { [fieldNameOrId: string]: unknown } }[],
    fieldKeyType: FieldKeyType,
    fieldRaws: IFieldRaws
  ) {
    const processedRecords = records.map((record) => {
      const fields: { [fieldIdOrName: string]: unknown } = { ...record.fields };
      for (const fieldRaw of fieldRaws) {
        const { type, options, isComputed } = fieldRaw;
        if (options == null || isComputed) continue;
        const optionsObj = JSON.parse(options) || {};
        const { defaultValue } = optionsObj;
        if (defaultValue == null) continue;
        const fieldIdOrName = fieldRaw[fieldKeyType];
        if (fields[fieldIdOrName] != null) continue;
        fields[fieldIdOrName] = this.getDefaultValue(type as FieldType, optionsObj, defaultValue);
      }

      return {
        ...record,
        fields,
      };
    });

    // After process to handle user field
    const userFields = fieldRaws.filter((fieldRaw) => fieldRaw.type === FieldType.User);
    if (userFields.length > 0) {
      return await this.fillUserInfo(processedRecords, userFields, fieldKeyType);
    }

    return processedRecords;
  }

  private async fillUserInfo(
    records: { id: string; fields: { [fieldNameOrId: string]: unknown } }[],
    userFields: IFieldRaws,
    fieldKeyType: FieldKeyType
  ) {
    const userIds = new Set<string>();
    records.forEach((record) => {
      userFields.forEach((field) => {
        const fieldIdOrName = field[fieldKeyType];
        const value = record.fields[fieldIdOrName];
        if (value) {
          if (Array.isArray(value)) {
            value.forEach((v) => userIds.add(v.id));
          } else {
            userIds.add((value as { id: string }).id);
          }
        }
      });
    });

    const userInfo = await this.getUserInfoFromDatabase(Array.from(userIds));

    return records.map((record) => {
      const updatedFields = { ...record.fields };
      userFields.forEach((field) => {
        const fieldIdOrName = field[fieldKeyType];
        const value = updatedFields[fieldIdOrName];
        if (value) {
          if (Array.isArray(value)) {
            updatedFields[fieldIdOrName] = value.map((v) => ({
              ...v,
              ...userInfo[v.id],
            }));
          } else {
            updatedFields[fieldIdOrName] = {
              ...value,
              ...userInfo[(value as { id: string }).id],
            };
          }
        }
      });
      return {
        ...record,
        fields: updatedFields,
      };
    });
  }

  private async getUserInfoFromDatabase(
    userIds: string[]
  ): Promise<{ [id: string]: { id: string; title: string; email: string } }> {
    const usersRaw = await this.prismaService.txClient().user.findMany({
      where: {
        id: { in: userIds },
        deletedTime: null,
      },
      select: {
        id: true,
        name: true,
        email: true,
      },
    });
    return keyBy(
      usersRaw.map((user) => ({ id: user.id, title: user.name, email: user.email })),
      'id'
    );
  }

  private transformUserDefaultValue(options: IUserFieldOptions, defaultValue: string | string[]) {
    const currentUserId = this.clsService.get('user.id');
    const defaultIds = uniq([defaultValue].flat().map((id) => (id === 'me' ? currentUserId : id)));

    if (options.isMultiple) {
      return defaultIds.map((id) => ({ id }));
    }
    return defaultIds[0] ? { id: defaultIds[0] } : undefined;
  }

  private getDefaultValue(type: FieldType, options: unknown, defaultValue: unknown) {
    switch (type) {
      case FieldType.Date:
        return defaultValue === 'now' ? new Date().toISOString() : defaultValue;
      case FieldType.SingleSelect:
        return Array.isArray(defaultValue) ? defaultValue[0] : defaultValue;
      case FieldType.MultipleSelect:
        return Array.isArray(defaultValue) ? defaultValue : [defaultValue];
      case FieldType.User:
        return this.transformUserDefaultValue(
          options as IUserFieldOptions,
          defaultValue as string | string[]
        );
      case FieldType.Checkbox:
        return defaultValue ? true : null;
      default:
        return defaultValue;
    }
  }

  async createRecords(
    tableId: string,
    recordsRo: IMakeOptional<IRecordInnerRo, 'id'>[],
    fieldKeyType: FieldKeyType = FieldKeyType.Name
  ): Promise<ICreateRecordsVo> {
    if (recordsRo.length === 0) {
      throw new BadRequestException('Create records is empty');
    }

    const records = recordsRo.map((record) => {
      const recordId = record.id || generateRecordId();
      return {
        ...record,
        id: recordId,
      };
    });

    const fieldRaws = await this.prismaService.txClient().field.findMany({
      where: { tableId, deletedTime: null },
      select: {
        id: true,
        name: true,
        type: true,
        options: true,
        unique: true,
        notNull: true,
        isComputed: true,
        isLookup: true,
        dbFieldName: true,
      },
    });

    await this.recordService.batchCreateRecords(tableId, records, fieldKeyType, fieldRaws);

    // submit auto fill changes
    const plainRecords = await this.appendDefaultValue(records, fieldKeyType, fieldRaws);

    const recordIds = plainRecords.map((r) => r.id);

    await this.fieldCalculationService.calComputedFieldsByRecordIds(tableId, recordIds);

    await this.calculateUpdatedRecord(tableId, fieldKeyType, plainRecords, true);

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
