import { Injectable, NotFoundException } from '@nestjs/common';
import { FieldKeyType, FieldType } from '@teable/core';
import type { IMakeOptional, IUserFieldOptions } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { IRecord, IRecordInsertOrderRo } from '@teable/openapi';
import { isEqual, forEach, keyBy, map } from 'lodash';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../../types/cls';
import { AttachmentsStorageService } from '../../attachments/attachments-storage.service';
import type { ICellContext, ICellChange } from '../../calculation/utils/changes';
import { formatChangesToOps, mergeDuplicateChange } from '../../calculation/utils/changes';
import { CollaboratorService } from '../../collaborator/collaborator.service';
import { DataLoaderService } from '../../data-loader/data-loader.service';
import { FieldConvertingService } from '../../field/field-calculate/field-converting.service';
import { createFieldInstanceByRaw } from '../../field/model/factory';
import { ViewOpenApiService } from '../../view/open-api/view-open-api.service';
import { ViewService } from '../../view/view.service';
import type { IRecordInnerRo } from '../record.service';
import { RecordService } from '../record.service';
import type { IFieldRaws } from '../type';
import { TypeCastAndValidate } from '../typecast.validate';

@Injectable()
export class RecordModifySharedService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly recordService: RecordService,
    private readonly fieldConvertingService: FieldConvertingService,
    private readonly viewOpenApiService: ViewOpenApiService,
    private readonly viewService: ViewService,
    private readonly attachmentsStorageService: AttachmentsStorageService,
    private readonly collaboratorService: CollaboratorService,
    private readonly cls: ClsService<IClsStore>,
    private readonly dataLoaderService: DataLoaderService
  ) {}

  // Shared change compression and filtering utilities
  async compressAndFilterChanges(
    tableId: string,
    cellContexts: ICellContext[]
  ): Promise<ICellChange[]> {
    if (!cellContexts.length) return [];

    const rawChanges: ICellChange[] = cellContexts.map((ctx) => ({
      tableId,
      recordId: ctx.recordId,
      fieldId: ctx.fieldId,
      newValue: ctx.newValue,
      oldValue: ctx.oldValue,
    }));

    const merged = mergeDuplicateChange(rawChanges);
    const nonNoop = merged.filter((c) => !isEqual(c.newValue, c.oldValue));
    if (!nonNoop.length) return [];

    const fieldIds = Array.from(new Set(nonNoop.map((c) => c.fieldId)));
    const sysTypes = [FieldType.LastModifiedTime, FieldType.LastModifiedBy];
    const sysFields = await this.prismaService.txClient().field.findMany({
      where: { tableId, id: { in: fieldIds }, deletedTime: null, type: { in: sysTypes } },
      select: { id: true },
    });
    const sysSet = new Set(sysFields.map((f) => f.id));
    return nonNoop.filter((c) => !sysSet.has(c.fieldId));
  }

  async getEffectFieldInstances(
    tableId: string,
    recordsFields: Record<string, unknown>[],
    fieldKeyType: FieldKeyType = FieldKeyType.Name,
    ignoreMissingFields: boolean = false
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

    if (!ignoreMissingFields && usedFields.length !== usedFieldIdsOrNames.length) {
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
    typecast: boolean = false,
    ignoreMissingFields: boolean = false
  ): Promise<T[]> {
    const recordsFields = map(records, 'fields');
    const effectFieldInstance = await this.getEffectFieldInstances(
      tableId,
      recordsFields,
      fieldKeyType,
      ignoreMissingFields
    );

    const newRecordsFields: Record<string, unknown>[] = recordsFields.map(() => ({}));
    for (const field of effectFieldInstance) {
      if (field.isComputed) continue;
      const typeCastAndValidate = new TypeCastAndValidate({
        services: {
          dataLoaderService: this.dataLoaderService,
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

  async generateCellContexts(
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
      where: {
        tableId,
        [fieldKeyType]: { in: fieldKeys },
        deletedTime: null,
      },
      select: { id: true, name: true, dbFieldName: true },
    });
    const fieldIdMap = keyBy(fieldRaws, fieldKeyType);

    const cellContexts: ICellContext[] = [];

    let oldRecordsMap: Record<string, IRecord> = {} as Record<string, IRecord>;
    if (!isNewRecord) {
      const oldRecords = (
        await this.recordService.getSnapshotBulk(
          tableId,
          records.map((r) => r.id),
          undefined,
          undefined,
          undefined,
          true
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
        const oldCellValue = isNewRecord ? null : oldRecordsMap[record.id]?.fields[fieldId];
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

  async getRecordOrderIndexes(tableId: string, orderRo: IRecordInsertOrderRo, recordCount: number) {
    const dbTableName = await this.recordService.getDbTableName(tableId);
    let indexes: number[] = [];
    await this.viewOpenApiService.updateRecordOrdersInner({
      tableId,
      dbTableName,
      itemLength: recordCount,
      indexField: await this.viewService.getOrCreateViewIndexField(dbTableName, orderRo.viewId),
      orderRo,
      update: async (result) => {
        indexes = result;
      },
    });
    return indexes;
  }

  async appendRecordOrderIndexes(
    tableId: string,
    records: IMakeOptional<IRecordInnerRo, 'id'>[],
    order: IRecordInsertOrderRo | undefined
  ) {
    if (!order) return records;
    const indexes = await this.getRecordOrderIndexes(tableId, order, records.length);
    return records.map((record, i) => ({
      ...record,
      order: indexes ? { [order.viewId]: indexes[i] } : undefined,
    }));
  }

  private transformUserDefaultValue(
    options: IUserFieldOptions,
    defaultValue: string | string[]
  ): unknown {
    const currentUserId = this.cls.get('user.id');
    const ids = Array.from(
      new Set([defaultValue].flat().map((id) => (id === 'me' ? currentUserId : id)))
    );
    return options.isMultiple ? ids.map((id) => ({ id })) : ids[0] ? { id: ids[0] } : undefined;
  }

  getDefaultValue(type: FieldType, options: unknown, defaultValue: unknown) {
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

  async getUserInfoFromDatabase(userIds: string[]) {
    const usersRaw = await this.prismaService.txClient().user.findMany({
      where: { id: { in: userIds }, deletedTime: null },
      select: { id: true, name: true, email: true },
    });
    return keyBy(
      usersRaw.map((u) => ({ id: u.id, title: u.name, email: u.email })),
      'id'
    );
  }

  async fillUserInfo(
    records: { id: string; fields: { [fieldNameOrId: string]: unknown } }[],
    userFields: IFieldRaws,
    fieldKeyType: FieldKeyType
  ) {
    const userIds = new Set<string>();
    records.forEach((record) => {
      userFields.forEach((field) => {
        const key = field[fieldKeyType];
        const v = record.fields[key] as unknown;
        if (v) {
          if (Array.isArray(v)) (v as { id: string }[]).forEach((i) => userIds.add(i.id));
          else userIds.add((v as { id: string }).id);
        }
      });
    });
    const info = await this.getUserInfoFromDatabase(Array.from(userIds));
    return records.map((record) => {
      const fields: Record<string, unknown> = { ...record.fields };
      userFields.forEach((field) => {
        const key = field[fieldKeyType];
        const v = fields[key] as unknown;
        if (v) {
          fields[key] = Array.isArray(v)
            ? (v as { id: string }[]).map((i) => ({ ...i, ...info[i.id] }))
            : { ...(v as { id: string }), ...info[(v as { id: string }).id] };
        }
      });
      return { ...record, fields };
    });
  }

  async appendDefaultValue(
    records: { id: string; fields: { [fieldNameOrId: string]: unknown } }[],
    fieldKeyType: FieldKeyType,
    fieldRaws: IFieldRaws
  ) {
    const processed = records.map((record) => {
      const fields: Record<string, unknown> = { ...record.fields };
      for (const f of fieldRaws) {
        const { type, options, isComputed } = f;
        if (options == null || isComputed) continue;
        const opts = JSON.parse(options) || {};
        const dv = opts.defaultValue;
        if (dv == null) continue;
        const key = f[fieldKeyType];
        if (fields[key] != null) continue;
        fields[key] = this.getDefaultValue(type as FieldType, opts, dv);
      }
      return { ...record, fields };
    });
    const userFields = fieldRaws.filter((f) => f.type === FieldType.User);
    if (userFields.length) return this.fillUserInfo(processed, userFields, fieldKeyType);
    return processed;
  }

  // Convenience re-export so callers don't need to import from utils
  formatChangesToOps = formatChangesToOps;
}
