import { Injectable } from '@nestjs/common';
import {
  FieldKeyType,
  FieldType,
  FormulaFieldCore,
  TableDomain,
  HttpErrorCode,
} from '@teable/core';
import type {
  FieldCore,
  IMakeOptional,
  IUserFieldOptions,
  LastModifiedByFieldCore,
  LastModifiedTimeFieldCore,
} from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { IRecord, IRecordInsertOrderRo } from '@teable/openapi';
import { isEqual, forEach, keyBy, map } from 'lodash';
import { ClsService } from 'nestjs-cls';
import { CustomHttpException } from '../../../custom.exception';
import type { IClsStore } from '../../../types/cls';
import { Timing } from '../../../utils/timing';
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
  compressAndFilterChanges(table: TableDomain, cellContexts: ICellContext[]): ICellChange[] {
    if (!cellContexts.length) return [];

    const rawChanges: ICellChange[] = cellContexts.map((ctx) => ({
      tableId: table.id,
      recordId: ctx.recordId,
      fieldId: ctx.fieldId,
      newValue: ctx.newValue,
      oldValue: ctx.oldValue,
    }));

    const merged = mergeDuplicateChange(rawChanges);
    const nonNoop = merged.filter((c) => !isEqual(c.newValue, c.oldValue));
    if (!nonNoop.length) return [];

    const fieldIds = Array.from(new Set(nonNoop.map((c) => c.fieldId)));
    const sysFields = table.getLastModifiedFields().filter((f) => {
      if (!fieldIds.includes(f.id)) return false;
      if (f.type === FieldType.LastModifiedTime) {
        const lmt = f as LastModifiedTimeFieldCore;
        // Only treat as a system field when it tracks all fields (generated column)
        return lmt.isTrackAll();
      }
      if (f.type === FieldType.LastModifiedBy) {
        return (f as LastModifiedByFieldCore).isTrackAll();
      }
      return true;
    });
    const sysSet = new Set(sysFields.map((f) => f.id));
    return nonNoop.filter((c) => !sysSet.has(c.fieldId));
  }

  private getEffectFieldInstances(
    table: TableDomain,
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
    const fieldsMap = table.getFieldsMap(fieldKeyType);

    const usedFields = usedFieldIdsOrNames
      .map((fieldIdOrName) => fieldsMap.get(fieldIdOrName))
      .filter((f): f is FieldCore => !!f);

    if (!ignoreMissingFields && usedFields.length !== usedFieldIdsOrNames.length) {
      const usedSet = new Set(map(usedFields, fieldKeyType));
      const missedFields = usedFieldIdsOrNames.filter(
        (fieldIdOrName) => !usedSet.has(fieldIdOrName)
      );
      throw new CustomHttpException(
        `Field ${fieldKeyType}: ${missedFields.join(', ')} not found`,
        HttpErrorCode.NOT_FOUND,
        {
          localization: {
            i18nKey: 'httpErrors.field.fieldKeyTypeNotFound',
            context: {
              fieldKeyType,
              missedFields: missedFields.join(', '),
            },
          },
        }
      );
    }
    return usedFields;
  }

  @Timing()
  async validateFieldsAndTypecast<
    T extends {
      fields: Record<string, unknown>;
    },
  >(
    table: TableDomain,
    records: T[],
    fieldKeyType: FieldKeyType = FieldKeyType.Name,
    typecast: boolean = false,
    ignoreMissingFields: boolean = false
  ): Promise<T[]> {
    const recordsFields = map(records, 'fields');
    const effectFieldInstance = this.getEffectFieldInstances(
      table,
      recordsFields,
      fieldKeyType,
      ignoreMissingFields
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
          dataLoaderService: this.dataLoaderService,
        },
        field,
        tableId: table.id,
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

  @Timing()
  async generateCellContexts(
    table: TableDomain,
    fieldKeyType: FieldKeyType,
    records: { id: string; fields: { [fieldNameOrId: string]: unknown } }[],
    isNewRecord?: boolean,
    projectionFields?: string[]
  ) {
    const fieldsMap = table.getFieldsMap(fieldKeyType);
    const projectionByFieldId =
      projectionFields && projectionFields.length > 0
        ? projectionFields.reduce<Record<string, boolean>>((acc, key) => {
            const field = fieldsMap.get(key);
            if (field) {
              acc[field.id] = true;
            }
            return acc;
          }, {})
        : records.reduce<Record<string, boolean>>((acc, record) => {
            Object.keys(record.fields).forEach((key) => {
              const field = fieldsMap.get(key);
              if (field) {
                acc[field.id] = true;
              }
            });
            return acc;
          }, {});

    const cellContexts: ICellContext[] = [];

    let oldRecordsMap: Record<string, IRecord> = {} as Record<string, IRecord>;
    if (!isNewRecord) {
      const oldRecords = (
        await this.recordService.getSnapshotBulk(
          table.id,
          records.map((r) => r.id),
          Object.keys(projectionByFieldId).length ? projectionByFieldId : undefined,
          FieldKeyType.Id,
          undefined,
          true
        )
      ).map((s) => s.data);
      oldRecordsMap = keyBy(oldRecords, 'id');
    }

    for (const record of records) {
      Object.entries(record.fields).forEach(([fieldNameOrId, value]) => {
        if (!fieldsMap.has(fieldNameOrId)) {
          throw new CustomHttpException(
            `Field ${fieldNameOrId} not found`,
            HttpErrorCode.NOT_FOUND,
            {
              localization: {
                i18nKey: 'httpErrors.field.notFound',
              },
            }
          );
        }
        const fieldId = fieldsMap.get(fieldNameOrId)!.id;
        const oldCellValue = isNewRecord ? null : oldRecordsMap[record.id]?.fields[fieldId] ?? null;
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

  async getRecordOrderIndexes(
    table: TableDomain,
    orderRo: IRecordInsertOrderRo,
    recordCount: number
  ) {
    const dbTableName = table.dbTableName;
    let indexes: number[] = [];
    await this.viewOpenApiService.updateRecordOrdersInner({
      tableId: table.id,
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
    table: TableDomain,
    records: IMakeOptional<IRecordInnerRo, 'id'>[],
    order: IRecordInsertOrderRo | undefined
  ) {
    if (!order) return records;
    const indexes = await this.getRecordOrderIndexes(table, order, records.length);
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
    userFields: readonly FieldCore[],
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

  @Timing()
  async ensureReferencedBaseFieldsForNewRecords(
    records: { id: string; fields: { [fieldNameOrId: string]: unknown } }[],
    fieldKeyType: FieldKeyType,
    fields: readonly FieldCore[]
  ) {
    if (!records.length) return records;

    const baseFieldKeyById = fields.reduce<Map<string, string | undefined>>((acc, field) => {
      if (this.isDerivedField(field)) {
        return acc;
      }
      const key = field[fieldKeyType] as string | undefined;
      acc.set(field.id, key);
      return acc;
    }, new Map());
    if (!baseFieldKeyById.size) {
      return records;
    }

    const baseFieldIds = Array.from(baseFieldKeyById.keys());
    if (!baseFieldIds.length) return records;

    const referencedRows = await this.prismaService.txClient().reference.findMany({
      where: {
        fromFieldId: { in: baseFieldIds },
      },
      select: { fromFieldId: true },
    });

    const referencedFieldIds = referencedRows.reduce<Set<string>>((acc, row) => {
      if (baseFieldKeyById.has(row.fromFieldId)) {
        acc.add(row.fromFieldId);
      }
      return acc;
    }, new Set<string>());

    if (referencedFieldIds.size < baseFieldIds.length) {
      const fallbackReferenced = this.collectReferencedBaseFieldIdsFromFieldRaws(
        fields,
        baseFieldKeyById
      );
      fallbackReferenced.forEach((id) => referencedFieldIds.add(id));
    }

    const referencedFieldKeys = Array.from(referencedFieldIds).reduce<Set<string>>((acc, id) => {
      const key = baseFieldKeyById.get(id);
      if (key) {
        acc.add(key);
      }
      return acc;
    }, new Set());

    if (!referencedFieldKeys.size) return records;

    const hasOwn = Object.prototype.hasOwnProperty;

    return records.map((record) => {
      let fields = record.fields;
      let mutated = false;
      referencedFieldKeys.forEach((key) => {
        if (!hasOwn.call(fields, key)) {
          if (!mutated) {
            fields = { ...fields };
            mutated = true;
          }
          fields[key] = null;
        }
      });
      return mutated ? { ...record, fields } : record;
    });
  }

  @Timing()
  async appendDefaultValue(
    records: { id: string; fields: { [fieldNameOrId: string]: unknown } }[],
    fieldKeyType: FieldKeyType,
    fieldList: readonly FieldCore[]
  ) {
    const processed = records.map((record) => {
      const fields: Record<string, unknown> = { ...record.fields };
      for (const f of fieldList) {
        const { type, options, isComputed } = f;
        if (options == null || isComputed) continue;
        if (!('defaultValue' in options)) continue;
        const dv = options.defaultValue;
        if (dv == null) continue;
        const key = f[fieldKeyType];
        if (fields[key] != null) continue;
        fields[key] = this.getDefaultValue(type as FieldType, options, dv);
      }
      return { ...record, fields };
    });
    const userFields = fieldList.filter((f) => f.type === FieldType.User);
    if (userFields.length) return this.fillUserInfo(processed, userFields, fieldKeyType);
    return processed;
  }

  private collectReferencedBaseFieldIdsFromFieldRaws(
    fields: readonly FieldCore[],
    baseFieldKeyById: Map<string, string | undefined>
  ): Set<string> {
    const referenced = new Set<string>();
    const fieldById = new Map(fields.map((field) => [field.id, field]));
    const fieldByName = new Map(fields.map((field) => [field.name, field]));
    const memo = new Map<string, Set<string>>();
    const visiting = new Set<string>();

    const resolveField = (identifier: string): FieldCore | undefined => {
      if (!identifier) return undefined;
      return fieldById.get(identifier) ?? fieldByName.get(identifier);
    };

    const collectBaseDeps = (field: FieldCore | undefined): Set<string> => {
      if (!field) return new Set();
      if (!this.isDerivedField(field)) {
        return baseFieldKeyById.has(field.id) ? new Set([field.id]) : new Set();
      }
      const cached = memo.get(field.id);
      if (cached) return cached;
      if (visiting.has(field.id)) return new Set();
      visiting.add(field.id);

      const result = new Set<string>();
      memo.set(field.id, result);

      const appendBase = (identifier: string | undefined) => {
        if (!identifier) return;
        if (baseFieldKeyById.has(identifier)) {
          result.add(identifier);
          return;
        }
        const target = resolveField(identifier);
        if (target) {
          const nested = collectBaseDeps(target);
          nested.forEach((id) => result.add(id));
        }
      };

      if (field.type === FieldType.Formula) {
        const options = this.parseJsonValue<{ expression?: string }>(field.options);
        const expression = options?.expression;
        if (expression) {
          const deps = FormulaFieldCore.getReferenceFieldIds(expression);
          deps.forEach((dep) => appendBase(dep));
        }
      }

      if (field.isLookup || field.isConditionalLookup || this.isLookupLikeRollup(field)) {
        appendBase(this.extractLookupLinkFieldId(field));
      }

      visiting.delete(field.id);
      return result;
    };

    for (const field of fields) {
      if (!this.isDerivedField(field)) continue;
      const deps = collectBaseDeps(field);
      deps.forEach((id) => referenced.add(id));
    }
    return referenced;
  }

  private extractLookupLinkFieldId(field: FieldCore): string | undefined {
    const options = this.parseJsonValue<{ linkFieldId?: string }>(field.lookupOptions);
    return options?.linkFieldId;
  }

  private isDerivedField(field: FieldCore): boolean {
    if (field.isLookup || field.isConditionalLookup) {
      return true;
    }
    if (this.isLookupLikeRollup(field)) {
      return true;
    }
    if (field.type === FieldType.Formula) {
      return true;
    }
    return !!field.isComputed;
  }

  private isLookupLikeRollup(field: FieldCore): boolean {
    return field.type === FieldType.Rollup || field.type === FieldType.ConditionalRollup;
  }

  private parseJsonValue<T>(value: unknown): T | undefined {
    if (value == null) return undefined;
    if (typeof value === 'string') {
      try {
        return JSON.parse(value) as T;
      } catch {
        return undefined;
      }
    }
    return value as T;
  }

  // Convenience re-export so callers don't need to import from utils
  formatChangesToOps = formatChangesToOps;
}
