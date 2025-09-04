import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import {
  FieldKeyType,
  CellFormat,
  FieldType,
  generateRecordId,
  generateOperationId,
} from '@teable/core';
import type { IMakeOptional, IUserFieldOptions } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  IUpdateRecordsRo,
  IRecord,
  ICreateRecordsRo,
  ICreateRecordsVo,
  IRecordInsertOrderRo,
} from '@teable/openapi';
import { forEach, keyBy, map, isEqual } from 'lodash';
import { ClsService } from 'nestjs-cls';
import { IThresholdConfig, ThresholdConfig } from '../../../configs/threshold.config';
import { EventEmitterService } from '../../../event-emitter/event-emitter.service';
import { Events } from '../../../event-emitter/events';
import type { IClsStore } from '../../../types/cls';
import { retryOnDeadlock } from '../../../utils/retry-decorator';
import { AttachmentsStorageService } from '../../attachments/attachments-storage.service';
import { BatchService } from '../../calculation/batch.service';
import { LinkService } from '../../calculation/link.service';
import { SystemFieldService } from '../../calculation/system-field.service';
import type { ICellChange, ICellContext } from '../../calculation/utils/changes';
import { formatChangesToOps, mergeDuplicateChange } from '../../calculation/utils/changes';
import { CollaboratorService } from '../../collaborator/collaborator.service';
import { FieldConvertingService } from '../../field/field-calculate/field-converting.service';
import { createFieldInstanceByRaw } from '../../field/model/factory';
import { ViewOpenApiService } from '../../view/open-api/view-open-api.service';
import { ViewService } from '../../view/view.service';
import type { IRecordInnerRo } from '../record.service';
import { RecordService } from '../record.service';
import type { IFieldRaws } from '../type';
import { TypeCastAndValidate } from '../typecast.validate';

@Injectable()
export class RecordModifyService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly recordService: RecordService,
    private readonly fieldConvertingService: FieldConvertingService,
    private readonly systemFieldService: SystemFieldService,
    private readonly viewOpenApiService: ViewOpenApiService,
    private readonly viewService: ViewService,
    private readonly attachmentsStorageService: AttachmentsStorageService,
    private readonly collaboratorService: CollaboratorService,
    private readonly batchService: BatchService,
    private readonly linkService: LinkService,
    private readonly eventEmitterService: EventEmitterService,
    private readonly cls: ClsService<IClsStore>,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig
  ) {}

  private async compressAndFilterChanges(
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

  private async getEffectFieldInstances(
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

  private async validateFieldsAndTypecast<
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
          CellFormat.Json,
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
    const { records, order, fieldKeyType = FieldKeyType.Name, typecast } = updateRecordsRo;
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

      const typecastRecords = await this.validateFieldsAndTypecast(
        tableId,
        records as IRecordInnerRo[],
        fieldKeyType,
        typecast
      );

      const preparedRecords = await this.systemFieldService.getModifiedSystemOpsMap(
        tableId,
        fieldKeyType,
        typecastRecords
      );

      const ctxs = await this.generateCellContexts(tableId, fieldKeyType, preparedRecords);
      // Persist link foreign keys based on link contexts; ignore returned cellChanges
      await this.linkService.getDerivateByLink(tableId, ctxs);
      const changes = await this.compressAndFilterChanges(tableId, ctxs);
      const opsMap = formatChangesToOps(changes);
      await this.batchService.updateRecords(opsMap);
      return ctxs;
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

    const snapshots = await this.recordService.getSnapshotBulkWithPermission(
      tableId,
      recordIds,
      undefined,
      fieldKeyType
    );
    return {
      records: snapshots.map((snapshot) => snapshot.data),
      cellContexts,
    };
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
    const { fieldKeyType = FieldKeyType.Name, records } = updateRecordsRo;
    const preparedRecords = await this.systemFieldService.getModifiedSystemOpsMap(
      tableId,
      fieldKeyType,
      records
    );

    const cellContexts = await this.generateCellContexts(tableId, fieldKeyType, preparedRecords);
    await this.linkService.getDerivateByLink(tableId, cellContexts);
    const changes = await this.compressAndFilterChanges(tableId, cellContexts);
    const opsMap = formatChangesToOps(changes);
    await this.batchService.updateRecords(opsMap);
    return cellContexts;
  }

  // ===== Create logic (no JS-side recalculation) =====

  private async getRecordOrderIndexes(
    tableId: string,
    orderRo: IRecordInsertOrderRo,
    recordCount: number
  ) {
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

  private async appendRecordOrderIndexes(
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

  private async getUserInfoFromDatabase(userIds: string[]) {
    const usersRaw = await this.prismaService.txClient().user.findMany({
      where: { id: { in: userIds }, deletedTime: null },
      select: { id: true, name: true, email: true },
    });
    return keyBy(
      usersRaw.map((u) => ({ id: u.id, title: u.name, email: u.email })),
      'id'
    );
  }

  private async fillUserInfo(
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

  private async appendDefaultValue(
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

  async multipleCreateRecords(
    tableId: string,
    createRecordsRo: ICreateRecordsRo,
    ignoreMissingFields: boolean = false
  ): Promise<ICreateRecordsVo> {
    const { fieldKeyType = FieldKeyType.Name, records, typecast, order } = createRecordsRo;
    const typecastRecords = await this.validateFieldsAndTypecast<
      IMakeOptional<IRecordInnerRo, 'id'>
    >(tableId, records, fieldKeyType, typecast, ignoreMissingFields);
    const preparedRecords = await this.appendRecordOrderIndexes(tableId, typecastRecords, order);
    const chunkSize = this.thresholdConfig.calcChunkSize;
    const chunks: IMakeOptional<IRecordInnerRo, 'id'>[][] = [];
    for (let i = 0; i < preparedRecords.length; i += chunkSize) {
      chunks.push(preparedRecords.slice(i, i + chunkSize));
    }
    const acc: ICreateRecordsVo = { records: [] };
    for (const chunk of chunks) {
      const res = await this.createRecords(tableId, chunk, fieldKeyType);
      acc.records.push(...res.records);
    }
    return acc;
  }

  async createRecords(
    tableId: string,
    recordsRo: IMakeOptional<IRecordInnerRo, 'id'>[],
    fieldKeyType: FieldKeyType = FieldKeyType.Name,
    projection?: string[]
  ): Promise<ICreateRecordsVo> {
    if (recordsRo.length === 0) throw new BadRequestException('Create records is empty');
    const records = recordsRo.map((r) => ({ ...r, id: r.id || generateRecordId() }));
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
    const plainRecords = await this.appendDefaultValue(records, fieldKeyType, fieldRaws);
    const recordIds = plainRecords.map((r) => r.id);
    const createCtxs = await this.generateCellContexts(tableId, fieldKeyType, plainRecords, true);
    await this.linkService.getDerivateByLink(tableId, createCtxs);
    const changes = await this.compressAndFilterChanges(tableId, createCtxs);
    const opsMap = formatChangesToOps(changes);
    await this.batchService.updateRecords(opsMap);
    const snapshots = await this.recordService.getSnapshotBulkWithPermission(
      tableId,
      recordIds,
      this.recordService.convertProjection(projection),
      fieldKeyType,
      CellFormat.Json,
      false
    );
    return { records: snapshots.map((s) => s.data) };
  }

  async createRecordsOnlySql(tableId: string, createRecordsRo: ICreateRecordsRo): Promise<void> {
    const { fieldKeyType = FieldKeyType.Name, records, typecast } = createRecordsRo;
    const typecastRecords = await this.validateFieldsAndTypecast<
      IMakeOptional<IRecordInnerRo, 'id'>
    >(tableId, records, fieldKeyType, typecast);
    await this.recordService.createRecordsOnlySql(tableId, typecastRecords);
  }

  // ===== Delete logic (no JS-side recalculation) =====
  async deleteRecord(tableId: string, recordId: string, windowId?: string) {
    const result = await this.deleteRecords(tableId, [recordId], windowId);
    return result.records[0];
  }

  async deleteRecords(tableId: string, recordIds: string[], windowId?: string) {
    const { records, orders } = await this.prismaService.$tx(async () => {
      const records = await this.recordService.getRecordsById(tableId, recordIds, false);
      // Pre-clean link foreign keys to satisfy FK constraints, without JS-side recalculation
      const cellContextsByTableId = await this.linkService.getDeleteRecordUpdateContext(
        tableId,
        records.records
      );
      for (const effectedTableId in cellContextsByTableId) {
        const cellContexts = cellContextsByTableId[effectedTableId];
        await this.linkService.getDerivateByLink(effectedTableId, cellContexts);
      }

      const orders = windowId
        ? await this.recordService.getRecordIndexes(tableId, recordIds)
        : undefined;
      await this.recordService.batchDeleteRecords(tableId, recordIds);
      return { records, orders };
    });

    this.eventEmitterService.emitAsync(Events.OPERATION_RECORDS_DELETE, {
      operationId: generateOperationId(),
      windowId,
      tableId,
      userId: this.cls.get('user.id'),
      records: records.records.map((record, index) => ({
        ...record,
        order: orders?.[index],
      })),
    });

    return records;
  }
}
