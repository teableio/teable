/* eslint-disable sonarjs/cognitive-complexity */
/* eslint-disable @typescript-eslint/naming-convention */
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  CellValueType,
  FieldKeyType,
  FieldOpBuilder,
  FieldType,
  generateFieldId,
  generateOperationId,
  IFieldRo,
  StatisticsFunc,
  isRollupFunctionSupportedForCellValueType,
  isLinkLookupOptions,
  isFieldReferenceValue,
  isFieldReferenceComparable,
  extractFieldIdsFromFilter,
} from '@teable/core';
import type {
  IColumn,
  IFieldVo,
  IConvertFieldRo,
  IUpdateFieldRo,
  IOtOperation,
  IColumnMeta,
  ILinkFieldOptions,
  IConditionalRollupFieldOptions,
  IConditionalLookupOptions,
  IRollupFieldOptions,
  IGetFieldsQuery,
  IFilter,
  IFilterItem,
  IFieldReferenceValue,
} from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { IDuplicateFieldRo } from '@teable/openapi';
import { instanceToPlain } from 'class-transformer';
import { Knex } from 'knex';
import { groupBy, isEqual, omit, pick } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { ThresholdConfig, IThresholdConfig } from '../../../configs/threshold.config';
import { FieldReferenceCompatibilityException } from '../../../db-provider/filter-query/cell-value-filter.abstract';
import { EventEmitterService } from '../../../event-emitter/event-emitter.service';
import { Events } from '../../../event-emitter/events';
import type { IClsStore } from '../../../types/cls';
import { Timing } from '../../../utils/timing';
import { FieldCalculationService } from '../../calculation/field-calculation.service';
import type { IOpsMap } from '../../calculation/utils/compose-maps';
import { GraphService } from '../../graph/graph.service';
import { ComputedOrchestratorService } from '../../record/computed/services/computed-orchestrator.service';
import { RecordOpenApiService } from '../../record/open-api/record-open-api.service';
import { InjectRecordQueryBuilder, IRecordQueryBuilder } from '../../record/query-builder';
import { RecordService } from '../../record/record.service';
import { TableIndexService } from '../../table/table-index.service';
import { ViewOpenApiService } from '../../view/open-api/view-open-api.service';
import { ViewService } from '../../view/view.service';
import { FieldConvertingService } from '../field-calculate/field-converting.service';
import { FieldCreatingService } from '../field-calculate/field-creating.service';
import { FieldDeletingService } from '../field-calculate/field-deleting.service';
import { FieldSupplementService } from '../field-calculate/field-supplement.service';
import { FieldViewSyncService } from '../field-calculate/field-view-sync.service';
import { FieldService } from '../field.service';
import type { IFieldInstance } from '../model/factory';
import {
  convertFieldInstanceToFieldVo,
  createFieldInstanceByRaw,
  createFieldInstanceByVo,
  rawField2FieldObj,
} from '../model/factory';
@Injectable()
export class FieldOpenApiService {
  private logger = new Logger(FieldOpenApiService.name);
  constructor(
    private readonly graphService: GraphService,
    private readonly prismaService: PrismaService,
    private readonly fieldService: FieldService,
    private readonly viewService: ViewService,
    private readonly viewOpenApiService: ViewOpenApiService,
    private readonly fieldCreatingService: FieldCreatingService,
    private readonly fieldDeletingService: FieldDeletingService,
    private readonly fieldConvertingService: FieldConvertingService,
    private readonly fieldSupplementService: FieldSupplementService,
    private readonly fieldCalculationService: FieldCalculationService,
    private readonly fieldViewSyncService: FieldViewSyncService,
    private readonly recordService: RecordService,
    private readonly eventEmitterService: EventEmitterService,
    private readonly cls: ClsService<IClsStore>,
    private readonly tableIndexService: TableIndexService,
    private readonly recordOpenApiService: RecordOpenApiService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig,
    @InjectRecordQueryBuilder() private readonly recordQueryBuilder: IRecordQueryBuilder,
    private readonly computedOrchestrator: ComputedOrchestratorService
  ) {}

  async planField(tableId: string, fieldId: string) {
    return await this.graphService.planField(tableId, fieldId);
  }

  private isFieldReferenceCompatibilityError(
    error: unknown
  ): error is FieldReferenceCompatibilityException {
    return error instanceof FieldReferenceCompatibilityException;
  }

  async planFieldCreate(tableId: string, fieldRo: IFieldRo) {
    return await this.graphService.planFieldCreate(tableId, fieldRo);
  }

  // need add delete relative check
  async planFieldConvert(tableId: string, fieldId: string, updateFieldRo: IConvertFieldRo) {
    return await this.graphService.planFieldConvert(tableId, fieldId, updateFieldRo);
  }

  async planDeleteField(tableId: string, fieldId: string) {
    return await this.graphService.planDeleteField(tableId, fieldId);
  }

  async getFields(tableId: string, query: IGetFieldsQuery) {
    return await this.fieldService.getFieldsByQuery(tableId, {
      ...query,
      filterHidden: query.filterHidden == null ? true : query.filterHidden,
    });
  }

  private async validateLookupField(field: IFieldInstance) {
    if (field.lookupOptions && isLinkLookupOptions(field.lookupOptions)) {
      const { foreignTableId, lookupFieldId, linkFieldId } = field.lookupOptions;
      const foreignField = await this.prismaService.txClient().field.findFirst({
        where: { tableId: foreignTableId, id: lookupFieldId, deletedTime: null },
        select: { id: true },
      });

      if (!foreignField) {
        return false;
      }
      const linkField = await this.prismaService.txClient().field.findFirst({
        where: { id: linkFieldId, deletedTime: null },
        select: { id: true, options: true, type: true, isLookup: true },
      });
      if (!linkField || linkField.type !== FieldType.Link || linkField.isLookup) {
        return false;
      }
      const linkOptions = JSON.parse(linkField?.options as string) as ILinkFieldOptions;
      return linkOptions.foreignTableId === foreignTableId;
    }
    return true;
  }

  private normalizeCellValueType(rawCellType: unknown): CellValueType {
    if (
      typeof rawCellType === 'string' &&
      Object.values(CellValueType).includes(rawCellType as CellValueType)
    ) {
      return rawCellType as CellValueType;
    }
    return CellValueType.String;
  }

  private async isRollupAggregationSupported(params: {
    expression?: IRollupFieldOptions['expression'];
    lookupFieldId?: string;
    foreignTableId?: string;
  }): Promise<boolean> {
    const { expression, lookupFieldId, foreignTableId } = params;

    if (!expression || !lookupFieldId || !foreignTableId) {
      return false;
    }

    const foreignField = await this.prismaService.txClient().field.findFirst({
      where: { id: lookupFieldId, tableId: foreignTableId, deletedTime: null },
      select: { cellValueType: true },
    });

    if (!foreignField?.cellValueType) {
      return false;
    }

    const cellValueType = this.normalizeCellValueType(foreignField.cellValueType);
    return isRollupFunctionSupportedForCellValueType(expression, cellValueType);
  }

  private async validateRollupAggregation(field: IFieldInstance): Promise<boolean> {
    if (!field.lookupOptions || !isLinkLookupOptions(field.lookupOptions)) {
      return false;
    }

    const options = field.options as IRollupFieldOptions | undefined;
    return this.isRollupAggregationSupported({
      expression: options?.expression,
      lookupFieldId: field.lookupOptions.lookupFieldId,
      foreignTableId: field.lookupOptions.foreignTableId,
    });
  }

  private async validateConditionalRollupAggregation(hostTableId: string, field: IFieldInstance) {
    const options = field.options as IConditionalRollupFieldOptions | undefined;
    const expression = options?.expression;
    const lookupFieldId = options?.lookupFieldId;
    const foreignTableId = options?.foreignTableId;

    const aggregationSupported = await this.isRollupAggregationSupported({
      expression,
      lookupFieldId,
      foreignTableId,
    });
    if (!aggregationSupported) {
      return false;
    }

    if (!foreignTableId) {
      return false;
    }

    return await this.validateFilterFieldReferences(hostTableId, foreignTableId, options?.filter);
  }

  private async validateConditionalLookup(tableId: string, field: IFieldInstance) {
    const meta = field.getConditionalLookupOptions?.();
    const lookupFieldId = meta?.lookupFieldId;
    const foreignTableId = meta?.foreignTableId;

    if (!lookupFieldId || !foreignTableId) {
      return false;
    }

    const foreignField = await this.prismaService.txClient().field.findFirst({
      where: { id: lookupFieldId, tableId: foreignTableId, deletedTime: null },
      select: { id: true, type: true },
    });

    if (!foreignField) {
      return false;
    }

    if (foreignField.type !== field.type) {
      return false;
    }

    return await this.validateFilterFieldReferences(tableId, foreignTableId, meta?.filter);
  }

  private async isFieldConfigurationValid(
    tableId: string,
    field: IFieldInstance
  ): Promise<boolean> {
    if (
      field.lookupOptions &&
      field.type !== FieldType.ConditionalRollup &&
      !field.isConditionalLookup
    ) {
      const lookupValid = await this.validateLookupField(field);
      if (!lookupValid) {
        return false;
      }

      if (field.type === FieldType.Rollup) {
        return await this.validateRollupAggregation(field);
      }

      return true;
    }

    if (field.isConditionalLookup) {
      return await this.validateConditionalLookup(tableId, field);
    }

    if (field.type === FieldType.ConditionalRollup) {
      return await this.validateConditionalRollupAggregation(tableId, field);
    }

    return true;
  }

  private async findConditionalFilterDependentFields(startFieldIds: readonly string[]): Promise<
    Array<{
      id: string;
      tableId: string;
      type: string;
      options: string | null;
      lookupOptions: string | null;
      isConditionalLookup: boolean;
    }>
  > {
    if (!startFieldIds.length) {
      return [];
    }

    const nonRecursive = this.knex
      .select('from_field_id', 'to_field_id')
      .from('reference')
      .whereIn('from_field_id', startFieldIds);

    const recursive = this.knex
      .select({ from_field_id: 'r.from_field_id', to_field_id: 'r.to_field_id' })
      .from({ r: 'reference' })
      .join({ d: 'dep' }, 'r.from_field_id', 'd.to_field_id');

    const query = this.knex
      .withRecursive('dep', ['from_field_id', 'to_field_id'], nonRecursive.union(recursive))
      .select({
        id: 'f.id',
        table_id: 'f.table_id',
        type: 'f.type',
        options: 'f.options',
        lookup_options: 'f.lookup_options',
        is_conditional_lookup: 'f.is_conditional_lookup',
      })
      .from({ dep: 'dep' })
      .join({ f: 'field' }, 'dep.to_field_id', 'f.id')
      .whereNull('f.deleted_time')
      .andWhere((qb) =>
        qb.where('f.type', FieldType.ConditionalRollup).orWhere('f.is_conditional_lookup', true)
      )
      .distinct();

    const rows = await this.prismaService.txClient().$queryRawUnsafe<
      Array<{
        id: string;
        table_id: string;
        type: string;
        options: string | null;
        lookup_options: string | null;
        is_conditional_lookup: number | boolean | null;
      }>
    >(query.toQuery());

    return rows.map((row) => ({
      id: row.id,
      tableId: row.table_id,
      type: row.type,
      options: row.options,
      lookupOptions: row.lookup_options,
      isConditionalLookup: Boolean(row.is_conditional_lookup),
    }));
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  private async syncConditionalFiltersByFieldChanges(
    newField: IFieldInstance,
    oldField: IFieldInstance
  ) {
    const fieldId = newField.id;
    if (!fieldId) {
      return;
    }

    const selectTypes = new Set([FieldType.SingleSelect, FieldType.MultipleSelect]);
    if (newField.type !== oldField.type || !selectTypes.has(newField.type)) {
      return;
    }

    const dependents = await this.findConditionalFilterDependentFields([fieldId]);
    if (!dependents.length) {
      return;
    }

    const pendingOps: Record<string, { fieldId: string; ops: IOtOperation[] }[]> = {};
    const enqueueFieldOps = (tableId: string, fieldId: string, ops: IOtOperation[]) => {
      if (!ops.length) return;
      (pendingOps[tableId] ||= []).push({ fieldId, ops });
    };
    const normalizeFilter = (filter: IFilter | null | undefined) =>
      filter && filter.filterSet?.length ? filter : null;

    for (const field of dependents) {
      if (field.type === FieldType.ConditionalRollup) {
        if (!field.options) continue;
        let options: IConditionalRollupFieldOptions;
        try {
          options = JSON.parse(field.options) as IConditionalRollupFieldOptions;
        } catch {
          continue;
        }

        const originalFilter = options.filter;
        if (!originalFilter) continue;
        const filterRefs = extractFieldIdsFromFilter(originalFilter, true);
        if (!filterRefs.includes(fieldId)) continue;

        const updatedFilter = this.fieldViewSyncService.getNewFilterByFieldChanges(
          originalFilter,
          newField,
          oldField
        );
        const normalizedOriginal = normalizeFilter(originalFilter);
        const normalizedUpdated = normalizeFilter(updatedFilter);

        if (isEqual(normalizedOriginal, normalizedUpdated)) continue;

        const ops = [
          FieldOpBuilder.editor.setFieldProperty.build({
            key: 'options',
            oldValue: options,
            newValue: { ...options, filter: normalizedUpdated },
          }),
        ];
        enqueueFieldOps(field.tableId, field.id, ops);
        continue;
      }

      if (!field.isConditionalLookup) continue;
      if (!field.lookupOptions) continue;

      let lookupOptions: IConditionalLookupOptions;
      try {
        lookupOptions = JSON.parse(field.lookupOptions) as IConditionalLookupOptions;
      } catch {
        continue;
      }

      const originalFilter = lookupOptions.filter;
      if (!originalFilter) continue;
      const filterRefs = extractFieldIdsFromFilter(originalFilter, true);
      if (!filterRefs.includes(fieldId)) continue;

      const updatedFilter = this.fieldViewSyncService.getNewFilterByFieldChanges(
        originalFilter,
        newField,
        oldField
      );
      const normalizedOriginal = normalizeFilter(originalFilter);
      const normalizedUpdated = normalizeFilter(updatedFilter);

      if (isEqual(normalizedOriginal, normalizedUpdated)) continue;

      const ops = [
        FieldOpBuilder.editor.setFieldProperty.build({
          key: 'lookupOptions',
          oldValue: lookupOptions,
          newValue: { ...lookupOptions, filter: normalizedUpdated },
        }),
      ];
      enqueueFieldOps(field.tableId, field.id, ops);
    }

    for (const [targetTableId, ops] of Object.entries(pendingOps)) {
      await this.fieldService.batchUpdateFields(targetTableId, ops);
    }
  }

  private async validateFilterFieldReferences(
    hostTableId: string,
    foreignTableId: string,
    filter?: IFilter | null
  ): Promise<boolean> {
    if (!filter) {
      return true;
    }

    const foreignFieldIds = new Set<string>();
    const referenceFieldIds = new Set<string>();

    const collectFieldIds = (node: IFilter | IFilterItem) => {
      if (!node) {
        return;
      }

      if ('fieldId' in node) {
        foreignFieldIds.add(node.fieldId);

        const { value } = node;
        if (isFieldReferenceValue(value)) {
          referenceFieldIds.add(value.fieldId);
        } else if (Array.isArray(value)) {
          for (const entry of value) {
            if (isFieldReferenceValue(entry)) {
              referenceFieldIds.add(entry.fieldId);
            }
          }
        }
      } else if ('filterSet' in node) {
        node.filterSet.forEach((child) => collectFieldIds(child));
      }
    };

    collectFieldIds(filter);

    if (!referenceFieldIds.size) {
      return true;
    }

    const fieldIdsToFetch = Array.from(new Set([...foreignFieldIds, ...referenceFieldIds]));
    if (!fieldIdsToFetch.length) {
      return true;
    }

    const rawFields = await this.prismaService.txClient().field.findMany({
      where: { id: { in: fieldIdsToFetch }, deletedTime: null },
    });

    const instanceMap = new Map<string, IFieldInstance>();
    const hostFields = new Map<string, IFieldInstance>();
    const foreignFields = new Map<string, IFieldInstance>();

    for (const raw of rawFields) {
      const instance = createFieldInstanceByRaw(raw);
      instanceMap.set(raw.id, instance);

      if (raw.tableId === hostTableId) {
        hostFields.set(raw.id, instance);
      }

      if (raw.tableId === foreignTableId) {
        foreignFields.set(raw.id, instance);
      }
    }

    const resolveReferenceField = (reference: IFieldReferenceValue): IFieldInstance | undefined => {
      if (reference.tableId) {
        if (reference.tableId === hostTableId) {
          return hostFields.get(reference.fieldId);
        }
        if (reference.tableId === foreignTableId) {
          return foreignFields.get(reference.fieldId);
        }
      }

      return (
        hostFields.get(reference.fieldId) ??
        foreignFields.get(reference.fieldId) ??
        instanceMap.get(reference.fieldId)
      );
    };

    // eslint-disable-next-line sonarjs/cognitive-complexity
    const validateNode = (node: IFilter | IFilterItem): boolean => {
      if (!node) {
        return true;
      }

      if ('fieldId' in node) {
        const baseField = foreignFields.get(node.fieldId) ?? instanceMap.get(node.fieldId);
        if (!baseField) {
          return false;
        }

        const references: IFieldReferenceValue[] = [];
        const { value } = node;

        if (isFieldReferenceValue(value)) {
          references.push(value);
        } else if (Array.isArray(value)) {
          for (const entry of value) {
            if (isFieldReferenceValue(entry)) {
              references.push(entry);
            }
          }
        }

        return references.every((reference) => {
          const referenceField = resolveReferenceField(reference);
          if (!referenceField) {
            return false;
          }
          return isFieldReferenceComparable(baseField, referenceField);
        });
      }

      if ('filterSet' in node) {
        return node.filterSet.every((child) => validateNode(child));
      }

      return true;
    };

    return validateNode(filter);
  }

  private async markError(tableId: string, field: IFieldInstance, hasError: boolean) {
    if (hasError) {
      if (!field.hasError) {
        await this.fieldService.markError(tableId, [field.id], true);
      }
    } else {
      if (field.hasError) {
        await this.fieldService.markError(tableId, [field.id], false);
      }
    }
  }

  private async checkAndUpdateError(tableId: string, field: IFieldInstance) {
    const fieldReferenceIds = this.fieldSupplementService.getFieldReferenceIds(field);
    // Deduplicate field IDs since the same field can appear multiple times
    // (e.g., as lookupFieldId and in filter)
    const uniqueFieldReferenceIds = [...new Set(fieldReferenceIds)];

    const refFields = await this.prismaService.txClient().field.findMany({
      where: { id: { in: uniqueFieldReferenceIds }, deletedTime: null },
      select: { id: true },
    });

    if (refFields.length !== uniqueFieldReferenceIds.length) {
      await this.markError(tableId, field, true);
      return;
    }

    const curReference = await this.prismaService.txClient().reference.findMany({
      where: {
        toFieldId: field.id,
      },
    });
    const missingReferenceIds = uniqueFieldReferenceIds.filter(
      (refId) => !curReference.find((ref) => ref.fromFieldId === refId)
    );

    if (missingReferenceIds.length) {
      await this.prismaService.txClient().reference.createMany({
        data: missingReferenceIds.map((fromFieldId) => ({
          fromFieldId,
          toFieldId: field.id,
        })),
        skipDuplicates: true,
      });
    }

    const isValid = await this.isFieldConfigurationValid(tableId, field);
    await this.markError(tableId, field, !isValid);
  }

  async restoreReference(references: string[]) {
    const fieldRaws = await this.prismaService.txClient().field.findMany({
      where: { id: { in: references }, deletedTime: null },
    });

    for (const refFieldRaw of fieldRaws) {
      const refField = createFieldInstanceByRaw(refFieldRaw);
      await this.checkAndUpdateError(refFieldRaw.tableId, refField);
    }
  }

  private sortCreateFieldsByDependencies<
    T extends IFieldVo & { columnMeta?: IColumnMeta; references?: string[] },
  >(tableId: string, fields: T[]): T[] {
    if (!fields.length) return fields;

    const idSet = new Set(fields.map((f) => f.id));
    const originalIndex = fields.reduce<Record<string, number>>((acc, field, index) => {
      acc[field.id] = index;
      return acc;
    }, {});

    const depsByFieldId = new Map<string, string[]>();
    for (const field of fields) {
      const { columnMeta: _columnMeta, references: _references, ...fieldVo } = field;
      try {
        const instance = createFieldInstanceByVo(fieldVo);
        const deps = this.fieldSupplementService
          .getFieldReferenceIds(instance)
          .filter((id): id is string => typeof id === 'string' && idSet.has(id) && id !== field.id);
        depsByFieldId.set(field.id, deps);
      } catch (e) {
        this.logger.warn(
          `createFields: failed to resolve dependencies for ${field.id} in ${tableId}: ${String(e)}`
        );
        return fields;
      }
    }

    const indegree = new Map<string, number>();
    const outgoing = new Map<string, string[]>();
    for (const field of fields) {
      indegree.set(field.id, 0);
      outgoing.set(field.id, []);
    }

    for (const field of fields) {
      const deps = depsByFieldId.get(field.id) ?? [];
      for (const depId of deps) {
        outgoing.get(depId)?.push(field.id);
        indegree.set(field.id, (indegree.get(field.id) ?? 0) + 1);
      }
    }

    const ready: string[] = [];
    for (const field of fields) {
      if ((indegree.get(field.id) ?? 0) === 0) ready.push(field.id);
    }
    ready.sort((a, b) => (originalIndex[a] ?? 0) - (originalIndex[b] ?? 0));

    const orderedIds: string[] = [];
    while (ready.length) {
      const current = ready.shift()!;
      orderedIds.push(current);
      for (const next of outgoing.get(current) ?? []) {
        const nextDegree = (indegree.get(next) ?? 0) - 1;
        indegree.set(next, nextDegree);
        if (nextDegree === 0) {
          ready.push(next);
          ready.sort((a, b) => (originalIndex[a] ?? 0) - (originalIndex[b] ?? 0));
        }
      }
    }

    if (orderedIds.length !== fields.length) {
      this.logger.warn(
        `createFields: detected a dependency cycle in ${tableId}; falling back to input order`
      );
      return fields;
    }

    const byId = new Map(fields.map((f) => [f.id, f] as const));
    return orderedIds.map((id) => byId.get(id)!).filter(Boolean);
  }

  @Timing()
  async createFields(
    tableId: string,
    fields: (IFieldVo & { columnMeta?: IColumnMeta; references?: string[] })[]
  ) {
    if (!fields.length) return;

    const orderedFields = this.sortCreateFieldsByDependencies(tableId, fields);

    // Create fields and compute/publish record changes within the same transaction
    const createdFields = await this.prismaService.$tx(
      async () => {
        const created: { tableId: string; field: IFieldInstance }[] = [];
        const sourceEntries: Array<{ tableId: string; fieldIds: string[] }> = [];
        const referencesToRestore = new Set<string>();
        const pendingByTable = new Map<string, Set<string>>();

        const addSourceField = (tid: string, fieldId: string) => {
          let entry = sourceEntries.find((s) => s.tableId === tid);
          if (!entry) {
            entry = { tableId: tid, fieldIds: [] };
            sourceEntries.push(entry);
          }
          if (!entry.fieldIds.includes(fieldId)) {
            entry.fieldIds.push(fieldId);
          }
        };

        const markPending = (tid: string, fieldId: string) => {
          let set = pendingByTable.get(tid);
          if (!set) {
            set = new Set<string>();
            pendingByTable.set(tid, set);
          }
          set.add(fieldId);
        };

        const createPayload = orderedFields.map((field) => {
          const { columnMeta, references, ...fieldVo } = field;
          if (references?.length) {
            references.forEach((refId) => referencesToRestore.add(refId));
          }

          return {
            field: createFieldInstanceByVo(fieldVo),
            columnMeta: columnMeta as unknown as Record<string, IColumn>,
          };
        });

        await this.computedOrchestrator.computeCellChangesForFieldsAfterCreate(
          sourceEntries,
          async () => {
            const createResult = await this.fieldCreatingService.alterCreateFieldsInExistingTable(
              tableId,
              createPayload
            );
            created.push(...createResult);

            for (const { tableId: tid, field } of createResult) {
              addSourceField(tid, field.id);
              if (field.isComputed) {
                markPending(tid, field.id);
              }
            }

            if (referencesToRestore.size) {
              await this.restoreReference(Array.from(referencesToRestore));
            }

            // Ensure dependent formula generated columns are recreated BEFORE
            // evaluating and returning values in the computed pipeline.
            // This avoids UPDATE ... RETURNING selecting non-existent generated columns
            // right after restoring base fields.
            const createdFieldIds = created
              .filter((nf) => nf.tableId === tableId)
              .map((nf) => nf.field.id);
            if (createdFieldIds.length) {
              try {
                await this.fieldService.recreateDependentFormulaColumns(tableId, createdFieldIds);
              } catch (e) {
                this.logger.warn(
                  `createFields: failed to recreate dependent formulas for ${tableId}: ${String(e)}`
                );
              }
            }

            // Resolve pending computed fields in batches per table
            for (const [tid, ids] of pendingByTable.entries()) {
              const list = Array.from(ids);
              if (list.length) {
                await this.fieldService.resolvePending(tid, list);
              }
            }
          }
        );

        return created;
      },
      { timeout: this.thresholdConfig.bigTransactionTimeout }
    );

    // Recreate search indexes after schema changes (outside tx boundaries)
    for (const { tableId: tid, field } of createdFields) {
      await this.tableIndexService.createSearchFieldSingleIndex(tid, field);
    }
  }

  @Timing()
  async createFieldsByRo(tableId: string, fieldRos: IFieldRo[]): Promise<IFieldVo[]> {
    if (!fieldRos.length) return [];
    const fieldVos = await this.fieldSupplementService.prepareCreateFields(tableId, fieldRos);
    await this.createFields(tableId, fieldVos);
    return fieldVos;
  }

  private async getFieldReferenceMap(fieldIds: string[]) {
    const referencesRaw = await this.prismaService.reference.findMany({
      where: {
        fromFieldId: { in: fieldIds },
      },
      select: {
        fromFieldId: true,
        toFieldId: true,
      },
    });
    return groupBy(referencesRaw, 'fromFieldId');
  }

  @Timing()
  async createField(tableId: string, fieldRo: IFieldRo, windowId?: string) {
    const fieldVo = await this.fieldSupplementService.prepareCreateField(tableId, fieldRo);
    const fieldInstance = createFieldInstanceByVo(fieldVo);
    const columnMeta = fieldRo.order && {
      [fieldRo.order.viewId]: { order: fieldRo.order.orderIndex },
    };
    // Create field and compute/publish record changes within the same transaction
    const newFields = await this.prismaService.$tx(
      async () => {
        let created: { tableId: string; field: IFieldInstance }[] = [];
        const sourceEntries = [{ tableId, fieldIds: [fieldInstance.id] }];
        await this.computedOrchestrator.computeCellChangesForFieldsAfterCreate(
          sourceEntries,
          async () => {
            created = await this.fieldCreatingService.alterCreateField(
              tableId,
              fieldInstance,
              columnMeta
            );
            for (const { tableId: tid, field } of created) {
              let entry = sourceEntries.find((s) => s.tableId === tid);
              if (!entry) {
                entry = { tableId: tid, fieldIds: [] };
                sourceEntries.push(entry);
              }
              if (!entry.fieldIds.includes(field.id)) {
                entry.fieldIds.push(field.id);
              }
              if (field.isComputed) {
                await this.fieldService.resolvePending(tid, [field.id]);
              }
            }
          }
        );
        return created;
      },
      { timeout: this.thresholdConfig.bigTransactionTimeout }
    );

    for (const { tableId: tid, field } of newFields) {
      await this.tableIndexService.createSearchFieldSingleIndex(tid, field);
    }

    const referenceMap = await this.getFieldReferenceMap([fieldVo.id]);

    // Prefer emitting a VO converted from the created instance so computed props (e.g. recordRead)
    // are included consistently with snapshots.
    const createdMain = newFields.find(
      (nf) => nf.tableId === tableId && nf.field.id === fieldVo.id
    );
    const emitFieldVo = createdMain ? convertFieldInstanceToFieldVo(createdMain.field) : fieldVo;

    this.eventEmitterService.emitAsync(Events.OPERATION_FIELDS_CREATE, {
      windowId,
      tableId,
      userId: this.cls.get('user.id'),
      fields: [
        {
          ...emitFieldVo,
          columnMeta,
          references: referenceMap[fieldVo.id]?.map((ref) => ref.toFieldId),
        },
      ],
    });

    return fieldVo;
  }

  @Timing()
  async deleteFields(tableId: string, fieldIds: string[], windowId?: string) {
    const { fields, fieldVos, columnsMeta, referenceMap, records } = await this.prismaService.$tx(
      async () => {
        const fieldRaws = await this.prismaService.txClient().field.findMany({
          where: { tableId, id: { in: fieldIds }, deletedTime: null },
        });
        const fieldRawMap = new Map(fieldRaws.map((raw) => [raw.id, raw]));

        if (fieldRawMap.size !== fieldIds.length) {
          const notExistFieldId = fieldIds.find((id) => !fieldRawMap.has(id));
          throw new NotFoundException(`Field ${notExistFieldId} not found`);
        }

        const fieldVoList = fieldIds.map((id) => rawField2FieldObj(fieldRawMap.get(id)!));
        const fieldInstances = fieldVoList.map(createFieldInstanceByVo);

        const nonComputedFields = fieldInstances.filter((field) => !field.isComputed);
        const projection = nonComputedFields.map((field) => field.id);
        const recordSnapshot =
          projection.length === 0
            ? undefined
            : await this.recordService.getRecordsFields(
                tableId,
                {
                  projection,
                  fieldKeyType: FieldKeyType.Id,
                  take: -1,
                },
                true
              );

        const columnMetaMap = await this.viewService.getColumnsMetaMap(tableId, fieldIds);
        const refMap = await this.getFieldReferenceMap(fieldIds);

        // Drop per-field search indexes inside the same transaction boundary
        for (const field of fieldInstances) {
          try {
            await this.tableIndexService.deleteSearchFieldIndex(tableId, field);
          } catch (e) {
            this.logger.warn(`deleteFields: drop search index failed for ${field.id}: ${e}`);
          }
        }

        const sources = [{ tableId, fieldIds: fieldInstances.map((f) => f.id) }];
        await this.computedOrchestrator.computeCellChangesForFieldsBeforeDelete(
          sources,
          async () => {
            await this.fieldViewSyncService.deleteDependenciesByFieldIds(
              tableId,
              fieldInstances.map((f) => f.id)
            );
            for (const field of fieldInstances) {
              await this.fieldDeletingService.alterDeleteField(tableId, field);
            }
          }
        );

        return {
          fields: fieldInstances,
          fieldVos: fieldVoList,
          columnsMeta: columnMetaMap,
          referenceMap: refMap,
          records: recordSnapshot,
        };
      },
      { timeout: this.thresholdConfig.bigTransactionTimeout }
    );

    this.eventEmitterService.emitAsync(Events.OPERATION_FIELDS_DELETE, {
      operationId: generateOperationId(),
      windowId,
      tableId,
      userId: this.cls.get('user.id'),
      fields: fieldVos.map((field, i) => ({
        ...field,
        columnMeta: columnsMeta[i],
        references: fieldIds.concat(referenceMap[field.id]?.map((ref) => ref.toFieldId) || []),
      })),
      records,
    });

    return fields;
  }

  async deleteField(tableId: string, fieldId: string, windowId?: string) {
    await this.deleteFields(tableId, [fieldId], windowId);
  }

  private async updateUniqProperty(
    tableId: string,
    fieldId: string,
    key: 'name' | 'dbFieldName',
    value: string
  ) {
    const result = await this.prismaService.field
      .findFirstOrThrow({
        where: { id: fieldId, deletedTime: null },
        select: { [key]: true },
      })
      .catch(() => {
        throw new NotFoundException(`Field ${fieldId} not found`);
      });

    const hasDuplicated = await this.prismaService.field.findFirst({
      where: { tableId, [key]: value, deletedTime: null },
      select: { id: true },
    });

    if (hasDuplicated) {
      throw new BadRequestException(`Field ${key} ${value} already exists`);
    }

    return FieldOpBuilder.editor.setFieldProperty.build({
      key,
      oldValue: result[key],
      newValue: value,
    });
  }

  async updateField(tableId: string, fieldId: string, updateFieldRo: IUpdateFieldRo) {
    const ops: IOtOperation[] = [];
    if (updateFieldRo.name) {
      const op = await this.updateUniqProperty(tableId, fieldId, 'name', updateFieldRo.name);
      ops.push(op);
    }

    if (updateFieldRo.dbFieldName) {
      const op = await this.updateUniqProperty(
        tableId,
        fieldId,
        'dbFieldName',
        updateFieldRo.dbFieldName
      );
      const oldField = await this.prismaService.field.findFirstOrThrow({
        where: {
          id: fieldId,
          deletedTime: null,
        },
        select: {
          dbFieldName: true,
          id: true,
        },
      });
      // do not need in transaction, causing just index name
      await this.tableIndexService.updateSearchFieldIndexName(tableId, oldField, {
        id: oldField.id,
        dbFieldName: updateFieldRo?.dbFieldName ?? oldField.dbFieldName,
      });
      ops.push(op);
    }

    if (updateFieldRo.description !== undefined) {
      const { description } = await this.prismaService.field
        .findFirstOrThrow({
          where: { id: fieldId, deletedTime: null },
          select: { description: true },
        })
        .catch(() => {
          throw new NotFoundException(`Field ${fieldId} not found`);
        });

      ops.push(
        FieldOpBuilder.editor.setFieldProperty.build({
          key: 'description',
          oldValue: description,
          newValue: updateFieldRo.description,
        })
      );
    }

    await this.prismaService.$tx(async () => {
      await this.fieldService.batchUpdateFields(tableId, [{ fieldId, ops }]);
    });
  }

  async performConvertField({
    tableId,
    newField,
    oldField,
    modifiedOps,
    supplementChange,
    dependentFieldIds,
  }: {
    tableId: string;
    newField: IFieldInstance;
    oldField: IFieldInstance;
    modifiedOps?: IOpsMap;
    supplementChange?: {
      tableId: string;
      newField: IFieldInstance;
      oldField: IFieldInstance;
    };
    dependentFieldIds?: string[];
  }): Promise<{ compatibilityIssue: boolean }> {
    let encounteredCompatibilityIssue = false;

    const runStageCalculate = async (
      targetTableId: string,
      targetNewField: IFieldInstance,
      targetOldField: IFieldInstance,
      ops?: IOpsMap
    ) => {
      try {
        await this.fieldConvertingService.stageCalculate(
          targetTableId,
          targetNewField,
          targetOldField,
          ops
        );
      } catch (error) {
        if (this.isFieldReferenceCompatibilityError(error)) {
          encounteredCompatibilityIssue = true;
          return;
        }

        throw error;
      }
    };

    const sourceMap = new Map<string, Set<string>>();
    const shouldRecomputeSelf = this.fieldConvertingService.needCalculate(newField, oldField);
    const addSource = (tid: string, fieldIds: string[]) => {
      const set = sourceMap.get(tid) ?? new Set<string>();
      fieldIds.forEach((id) => set.add(id));
      sourceMap.set(tid, set);
    };

    if (shouldRecomputeSelf) {
      addSource(tableId, [newField.id]);
    }

    if (dependentFieldIds?.length) {
      const dependentFields = await this.prismaService.txClient().field.findMany({
        where: { id: { in: dependentFieldIds }, deletedTime: null },
        select: { id: true, tableId: true },
      });
      dependentFields
        .filter(
          ({ id, tableId: depTableId }) =>
            shouldRecomputeSelf || id !== newField.id || depTableId !== tableId
        )
        .forEach(({ id, tableId: depTableId }) => addSource(depTableId, [id]));
    }

    if (supplementChange) {
      addSource(supplementChange.tableId, [supplementChange.newField.id]);
    }

    const sources = Array.from(sourceMap.entries()).map(([tid, ids]) => ({
      tableId: tid,
      fieldIds: Array.from(ids),
    }));
    const hasSources = sources.length > 0;

    // 1. stage close constraint
    await this.fieldConvertingService.closeConstraint(tableId, newField, oldField);

    // 2. stage alter + apply record changes and calculate field with computed publishing (atomic)
    const runCompute = async () => {
      // Update dependencies and schema first so evaluate() sees new schema
      await this.fieldViewSyncService.convertDependenciesByFieldIds(tableId, newField, oldField);
      await this.syncConditionalFiltersByFieldChanges(newField, oldField);
      if (supplementChange) {
        const { newField: sNew, oldField: sOld } = supplementChange;
        await this.syncConditionalFiltersByFieldChanges(sNew, sOld);
      }
      await this.fieldConvertingService.deleteOrCreateSupplementLink(tableId, newField, oldField);
      await this.fieldConvertingService.stageAlter(tableId, newField, oldField);
      if (supplementChange) {
        const { tableId: sTid, newField: sNew, oldField: sOld } = supplementChange;
        await this.fieldConvertingService.stageAlter(sTid, sNew, sOld);
      }

      // Then apply record changes (base ops) prior to computed publishing
      await runStageCalculate(tableId, newField, oldField, modifiedOps);
      if (supplementChange) {
        const { tableId: sTid, newField: sNew, oldField: sOld } = supplementChange;
        await runStageCalculate(sTid, sNew, sOld);
      }
    };

    if (hasSources) {
      try {
        await this.computedOrchestrator.computeCellChangesForFields(sources, runCompute);
      } catch (error) {
        if (this.isFieldReferenceCompatibilityError(error)) {
          encounteredCompatibilityIssue = true;
        } else {
          throw error;
        }
      }
    } else {
      await runCompute();
    }

    // 4. stage supplement field constraint
    await this.fieldConvertingService.alterFieldConstraint(tableId, newField, oldField);

    // Persist values for a newly created symmetric link field (if any).
    // When using tableCache for reads, link values must be materialized in the physical column.
    try {
      const newOpts = (newField.options || {}) as {
        symmetricFieldId?: string;
        foreignTableId?: string;
      };
      const oldOpts = (oldField.options || {}) as { symmetricFieldId?: string };
      const createdSymmetricId =
        newOpts.symmetricFieldId && newOpts.symmetricFieldId !== oldOpts.symmetricFieldId;
      if (newField.type === FieldType.Link && createdSymmetricId && newOpts.foreignTableId) {
        await this.computedOrchestrator.computeCellChangesForFieldsAfterCreate(
          [
            {
              tableId: newOpts.foreignTableId,
              fieldIds: [newOpts.symmetricFieldId!],
            },
          ],
          async () => {
            // no-op; field already created
          }
        );
      }
    } catch (e) {
      this.logger.warn(`post-convert symmetric persist failed: ${String(e)}`);
    }

    return { compatibilityIssue: encounteredCompatibilityIssue };
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  async convertField(
    tableId: string,
    fieldId: string,
    updateFieldRo: IConvertFieldRo,
    windowId?: string
  ): Promise<IFieldVo> {
    const { oldFieldVo, newFieldVo, modifiedOps, references, supplementChange } =
      await this.prismaService.$tx(
        async () => {
          // stage analysis and collect field changes
          const analysisResult = await this.fieldConvertingService.stageAnalysis(
            tableId,
            fieldId,
            updateFieldRo
          );
          const { newField, oldField } = analysisResult;
          this.logger.debug(
            `convertField stageAnalysis done table=${tableId} field=${fieldId} newType=${newField.type} oldType=${oldField.type}`
          );

          const dependentRefs = await this.prismaService
            .txClient()
            .reference.findMany({ where: { fromFieldId: fieldId }, select: { toFieldId: true } });
          const dependentFieldIds = Array.from(
            new Set([
              ...(analysisResult.references ?? []),
              ...dependentRefs.map((ref) => ref.toFieldId),
            ])
          );

          const shouldRecomputeSelf = this.fieldConvertingService.needCalculate(newField, oldField);
          const filteredDependentFieldIds = shouldRecomputeSelf
            ? dependentFieldIds
            : dependentFieldIds.filter((id) => id !== newField.id);

          const { compatibilityIssue } = await this.performConvertField({
            tableId,
            newField,
            oldField,
            modifiedOps: analysisResult.modifiedOps,
            supplementChange: analysisResult.supplementChange,
            dependentFieldIds: filteredDependentFieldIds,
          });

          const shouldForceLookupError =
            oldField.type === FieldType.Link &&
            !oldField.isLookup &&
            !newField.isLookup &&
            (newField.type !== FieldType.Link ||
              ((newField.options as ILinkFieldOptions | undefined)?.foreignTableId ?? null) !==
                ((oldField.options as ILinkFieldOptions | undefined)?.foreignTableId ?? null));

          if (filteredDependentFieldIds.length) {
            await this.restoreReference(filteredDependentFieldIds);
            const dependentFieldRaws = await this.prismaService.txClient().field.findMany({
              where: { id: { in: filteredDependentFieldIds }, deletedTime: null },
            });

            if (dependentFieldRaws.length) {
              const dependentSourceMap = dependentFieldRaws.reduce<Record<string, Set<string>>>(
                (acc, field) => {
                  const set = acc[field.tableId] ?? new Set<string>();
                  set.add(field.id);
                  acc[field.tableId] = set;
                  return acc;
                },
                {}
              );
              const dependentSources = Object.entries(dependentSourceMap).map(([tid, ids]) => ({
                tableId: tid,
                fieldIds: Array.from(ids),
              }));
              if (dependentSources.length) {
                await this.computedOrchestrator.computeCellChangesForFields(
                  dependentSources,
                  async () => {
                    // schema/meta already up to date; nothing additional to run here
                  }
                );
              }
            }

            for (const raw of dependentFieldRaws) {
              const instance = createFieldInstanceByRaw(raw);
              const isValid = await this.isFieldConfigurationValid(raw.tableId, instance);
              await this.markError(raw.tableId, instance, !isValid);
            }

            if (shouldForceLookupError) {
              const lookupFieldsToMark = dependentFieldRaws.filter(
                (raw) =>
                  raw.id !== fieldId &&
                  (raw.isLookup ||
                    raw.type === FieldType.Rollup ||
                    raw.type === FieldType.ConditionalRollup)
              );
              if (lookupFieldsToMark.length) {
                const grouped = groupBy(lookupFieldsToMark, 'tableId');
                for (const [lookupTableId, fields] of Object.entries(grouped)) {
                  await this.fieldService.markError(
                    lookupTableId,
                    fields.map((f) => f.id),
                    true
                  );
                }
              }
            }
          }

          if (
            compatibilityIssue &&
            (newField.isConditionalLookup ||
              newField.isLookup ||
              newField.type === FieldType.ConditionalRollup)
          ) {
            await this.markError(tableId, newField, true);
          }

          const oldFieldVo = instanceToPlain(oldField, { excludePrefixes: ['_'] }) as IFieldVo;
          const newFieldVo = instanceToPlain(newField, { excludePrefixes: ['_'] }) as IFieldVo;

          return {
            oldFieldVo,
            newFieldVo,
            modifiedOps: analysisResult.modifiedOps,
            references: analysisResult.references,
            supplementChange: analysisResult.supplementChange,
          };
        },
        { timeout: this.thresholdConfig.bigTransactionTimeout }
      );

    this.cls.set('oldField', oldFieldVo);

    if (windowId) {
      this.eventEmitterService.emitAsync(Events.OPERATION_FIELD_CONVERT, {
        windowId,
        tableId,
        userId: this.cls.get('user.id'),
        oldField: oldFieldVo,
        newField: newFieldVo,
        modifiedOps,
        references,
        supplementChange,
      });
    }

    // Keep API response consistent with getField/getFields by filtering out meta
    return omit(newFieldVo, ['meta']) as IFieldVo;
  }

  async getFilterLinkRecords(tableId: string, fieldId: string) {
    const field = await this.fieldService.getField(tableId, fieldId);

    if (field.type === FieldType.Link) {
      const { filter, foreignTableId } = field.options as ILinkFieldOptions;

      if (!foreignTableId || !filter) {
        return [];
      }

      return this.viewOpenApiService.getFilterLinkRecordsByTable(foreignTableId, filter);
    }

    if (field.type === FieldType.ConditionalRollup) {
      const { filter, foreignTableId } = field.options as IConditionalRollupFieldOptions;

      if (!foreignTableId || !filter) {
        return [];
      }

      return this.viewOpenApiService.getFilterLinkRecordsByTable(foreignTableId, filter);
    }

    return [];
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  async duplicateField(
    sourceTableId: string,
    fieldId: string,
    duplicateFieldRo: IDuplicateFieldRo,
    windowId?: string
  ) {
    const { name, viewId } = duplicateFieldRo;
    const { newField } = await this.prismaService.$tx(
      async () => {
        const prisma = this.prismaService.txClient();

        // throw error if field not found
        const fieldRaw = await prisma.field.findUniqueOrThrow({
          where: {
            id: fieldId,
            deletedTime: null,
          },
        });

        const fieldName = await this.fieldSupplementService.uniqFieldName(sourceTableId, name);

        const dbFieldName = await this.fieldService.generateDbFieldName(sourceTableId, fieldName);

        const fieldInstance = createFieldInstanceByRaw(fieldRaw);

        const newFieldInstance = {
          ...fieldInstance,
          name: fieldName,
          dbFieldName,
          id: generateFieldId(),
        } as IFieldInstance;

        delete newFieldInstance.isPrimary;
        if (newFieldInstance.type === FieldType.Formula) {
          newFieldInstance.meta = undefined;
        }

        if (viewId) {
          const view = await prisma.view.findUniqueOrThrow({
            where: { id: viewId, deletedTime: null },
            select: {
              id: true,
              columnMeta: true,
            },
          });
          const columnMeta = (view.columnMeta ? JSON.parse(view.columnMeta) : {}) as IColumnMeta;
          const fieldViewOrder = columnMeta[fieldId]?.order;

          const getterFieldViewOrders = Object.values(columnMeta)
            .filter(({ order }) => order > fieldViewOrder)
            .map(({ order }) => order)
            .sort();

          const targetFieldViewOrder = getterFieldViewOrders?.length
            ? (getterFieldViewOrders[0] + fieldViewOrder) / 2
            : fieldViewOrder + 1;

          (newFieldInstance as IFieldRo).order = {
            viewId,
            orderIndex: targetFieldViewOrder,
          };
        }

        // create field may not support notNull and unique validate
        delete newFieldInstance.notNull;
        delete newFieldInstance.unique;

        if (fieldInstance.type === FieldType.Button) {
          newFieldInstance.options = omit(fieldInstance.options, ['workflow']);
        }

        if (FieldType.Link === fieldInstance.type && !fieldInstance.isLookup) {
          newFieldInstance.options = {
            ...pick(fieldInstance.options, [
              'filter',
              'filterByViewId',
              'foreignTableId',
              'relationship',
              'visibleFieldIds',
              'baseId',
            ]),
            // all link field should be one way link
            isOneWay: true,
          } as ILinkFieldOptions;
        }

        if (
          fieldInstance.isLookup ||
          fieldInstance.type === FieldType.Rollup ||
          fieldInstance.type === FieldType.ConditionalRollup
        ) {
          const sourceLookupOptions = fieldInstance.lookupOptions;
          if (sourceLookupOptions) {
            const normalizedLookupOptions = pick(sourceLookupOptions, [
              'foreignTableId',
              'lookupFieldId',
              'linkFieldId',
              'filter',
              'sort',
              'limit',
            ]);
            if (Object.keys(normalizedLookupOptions).length > 0) {
              newFieldInstance.lookupOptions =
                normalizedLookupOptions as IFieldInstance['lookupOptions'];
            } else {
              delete newFieldInstance.lookupOptions;
            }
          } else {
            delete newFieldInstance.lookupOptions;
          }
        }

        // after create field, and add constraint relative
        const newField = await this.createField(sourceTableId, {
          ...omit(newFieldInstance, ['notNull', 'unique']),
        });

        if (!fieldInstance.isComputed && fieldInstance.type !== FieldType.Button) {
          // Duplicate records synchronously to avoid cross-transaction CLS leaks
          await this.duplicateFieldData(
            sourceTableId,
            newField.id,
            fieldRaw.dbFieldName,
            omit(newFieldInstance, 'order') as IFieldInstance,
            { sourceFieldId: fieldRaw.id }
          );
        }

        return { newField };
      },
      { timeout: this.thresholdConfig.bigTransactionTimeout }
    );

    this.eventEmitterService.emitAsync(Events.OPERATION_FIELDS_CREATE, {
      operationId: generateOperationId(),
      windowId,
      tableId: sourceTableId,
      userId: this.cls.get('user.id'),
      fields: [newField],
    });

    return newField;
  }

  async duplicateFieldData(
    sourceTableId: string,
    targetFieldId: string,
    sourceDbFieldName: string,
    fieldInstance: IFieldInstance,
    opts: { sourceFieldId: string }
  ) {
    const chunkSize = 1000;

    const dbTableName = await this.fieldService.getDbTableName(sourceTableId);

    // Use the SOURCE field for filtering/counting so we only fetch rows where
    // the original field has a value. The new field is empty at this point.
    const sourceFieldId = opts.sourceFieldId;
    const sourceFieldForFilter = { ...fieldInstance, id: sourceFieldId } as IFieldInstance;

    const count = await this.getFieldRecordsCount(dbTableName, sourceTableId, sourceFieldForFilter);

    if (!count) {
      if (fieldInstance.notNull || fieldInstance.unique) {
        await this.convertField(sourceTableId, targetFieldId, {
          ...fieldInstance,
          notNull: fieldInstance.notNull,
          unique: fieldInstance.unique,
        });
      }
      return;
    }

    const page = Math.ceil(count / chunkSize);

    for (let i = 0; i < page; i++) {
      const sourceRecords = await this.getFieldRecords(
        dbTableName,
        sourceTableId,
        sourceFieldForFilter,
        sourceDbFieldName,
        i,
        chunkSize
      );

      if (!fieldInstance.isComputed && fieldInstance.type !== FieldType.Button) {
        await this.prismaService.$tx(async () => {
          await this.recordOpenApiService.simpleUpdateRecords(sourceTableId, {
            fieldKeyType: FieldKeyType.Id,
            typecast: true,
            records: sourceRecords.map((record) => ({
              id: record.id,
              fields: {
                [targetFieldId]: record.value,
              },
            })),
          });
        });
      }
    }

    if (fieldInstance.notNull || fieldInstance.unique) {
      await this.convertField(sourceTableId, targetFieldId, {
        ...fieldInstance,
        notNull: fieldInstance.notNull,
        unique: fieldInstance.unique,
      });
    }
  }

  private async getFieldRecordsCount(dbTableName: string, tableId: string, field: IFieldInstance) {
    // Build a filter that counts only non-empty values for the field
    // - For boolean (checkbox) fields: use OR(is true, is false)
    // - For other fields: use isNotEmpty
    const filter: IFilter =
      field.cellValueType === CellValueType.Boolean
        ? {
            conjunction: 'or',
            filterSet: [
              { fieldId: field.id, operator: 'is', value: true },
              { fieldId: field.id, operator: 'is', value: false },
            ],
          }
        : {
            conjunction: 'and',
            filterSet: [{ fieldId: field.id, operator: 'isNotEmpty', value: null }],
          };

    const { qb } = await this.recordQueryBuilder.createRecordAggregateBuilder(dbTableName, {
      tableId,
      viewId: undefined,
      filter,
      aggregationFields: [
        {
          // Use Count with '*' so it just counts filtered rows
          fieldId: '*',
          statisticFunc: StatisticsFunc.Count,
          alias: 'count',
        },
      ],
      useQueryModel: true,
    });

    const query = qb.toQuery();
    const result = await this.prismaService.txClient().$queryRawUnsafe<{ count: number }[]>(query);
    return Number(result[0].count);
  }

  private async getFieldRecords(
    dbTableName: string,
    tableId: string,
    field: IFieldInstance,
    dbFieldName: string,
    page: number,
    chunkSize: number
  ) {
    // Align fetching with counting logic: only fetch non-empty values for the field
    const filter: IFilter =
      field.cellValueType === CellValueType.Boolean
        ? {
            conjunction: 'or',
            filterSet: [
              { fieldId: field.id, operator: 'is', value: true },
              { fieldId: field.id, operator: 'is', value: false },
            ],
          }
        : {
            conjunction: 'and',
            filterSet: [{ fieldId: field.id, operator: 'isNotEmpty', value: null }],
          };

    const { qb } = await this.recordQueryBuilder.createRecordQueryBuilder(dbTableName, {
      tableId,
      viewId: undefined,
      filter,
      useQueryModel: true,
    });
    const query = qb
      // TODO: handle where now link or lookup cannot use alias
      // .whereNotNull(dbFieldName)
      .orderBy('__auto_number')
      .limit(chunkSize)
      .offset(page * chunkSize)
      .toQuery();
    const result = await this.prismaService
      .txClient()
      .$queryRawUnsafe<{ __id: string; [key: string]: string }[]>(query);
    this.logger.debug('getFieldRecords: ', result);
    return result.map((item) => ({
      id: item.__id,
      value: item[dbFieldName] as string,
    }));
  }

  getFieldUniqueKeyName(dbTableName: string, dbFieldName: string, fieldId: string) {
    return this.fieldService.getFieldUniqueKeyName(dbTableName, dbFieldName, fieldId);
  }
}
