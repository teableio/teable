/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable sonarjs/cognitive-complexity */
import { Injectable, HttpException, HttpStatus, Inject, forwardRef } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import {
  CellFormat,
  CellValueType,
  FieldKeyType,
  FieldType,
  TimeFormatting,
  formatDateToString,
  isMeTag,
  parseClipboardText,
  type IDatetimeFormatting,
  type IFilter,
  type IFilterSet,
} from '@teable/core';
import type {
  IUpdateRecordRo,
  IFormSubmitRo,
  IRecord,
  ICreateRecordsRo,
  ICreateRecordsVo,
  IGetRecordsRo,
  IPasteRo,
  IPasteVo,
  IRangesRo,
  IRecordsVo,
  IRecordInsertOrderRo,
  IUpdateRecordsRo,
} from '@teable/openapi';
import { RangeType } from '@teable/openapi';
import {
  executeCreateRecordsEndpoint,
  executeSubmitRecordEndpoint,
  executeDeleteRecordsEndpoint,
  executeDeleteByRangeEndpoint,
  executePasteEndpoint,
  executeClearEndpoint,
  executeUpdateRecordEndpoint,
  executeUpdateRecordsEndpoint,
  executeDuplicateRecordEndpoint,
  executeReorderRecordsEndpoint,
  executeListTableRecordsEndpoint,
} from '@teable/v2-contract-http-implementation/handlers';
import { v2CoreTokens } from '@teable/v2-core';
import type {
  ICommandBus,
  IExecutionContext,
  IListTableRecordsQueryInput,
  IQueryBus,
  RecordFilter,
  RecordFilterDateValue,
  RecordFilterGroup,
  RecordFilterNode,
  RecordFilterOperator,
  RecordFilterValue,
} from '@teable/v2-core';
import { ClsService } from 'nestjs-cls';
import { CacheService } from '../../../cache/cache.service';
import type { ICacheStore } from '../../../cache/types';
import { CustomHttpException, getDefaultCodeByStatus } from '../../../custom.exception';
import type { IClsStore } from '../../../types/cls';
import { AggregationService } from '../../aggregation/aggregation.service';
import { FieldService } from '../../field/field.service';
import { SelectionService } from '../../selection/selection.service';
import { TableService } from '../../table/table.service';
import {
  buildUndoRedoEnginePreferenceKey,
  UNDO_REDO_ENGINE_PREFERENCE_TTL_SECONDS,
} from '../../undo-redo/open-api/undo-redo-engine-preference';
import { V2_RECORD_PASTE_AUDIT_CONTEXT_KEY } from '../../v2/v2-audit-log.constants';
import { V2ContainerService } from '../../v2/v2-container.service';
import { V2ExecutionContextFactory } from '../../v2/v2-execution-context.factory';
import { RecordPermissionService } from '../record-permission.service';
import { RecordService } from '../record.service';

const internalServerError = 'Internal server error';
const invalidFilterCode = 'validation.invalid_filter';
const v1SymbolOperatorMap: Record<string, string> = {
  '=': 'is',
  '!=': 'isNot',
  '>': 'isGreater',
  '>=': 'isGreaterEqual',
  '<': 'isLess',
  '<=': 'isLessEqual',
  LIKE: 'contains',
  'NOT LIKE': 'doesNotContain',
  IN: 'isAnyOf',
  'NOT IN': 'isNoneOf',
  HAS: 'hasAllOf',
  'IS NULL': 'isEmpty',
  'IS NOT NULL': 'isNotEmpty',
  'IS WITH IN': 'isWithIn',
};

@Injectable()
export class RecordOpenApiV2Service {
  constructor(
    private readonly v2ContainerService: V2ContainerService,
    private readonly v2ContextFactory: V2ExecutionContextFactory,
    private readonly recordService: RecordService,
    private readonly tableService: TableService,
    private readonly cls: ClsService<IClsStore>,
    private readonly cacheService: CacheService<ICacheStore>,
    private readonly fieldService: FieldService,
    private readonly recordPermissionService: RecordPermissionService,
    private readonly aggregationService: AggregationService,
    @Inject(forwardRef(() => SelectionService))
    private readonly selectionService: SelectionService
  ) {}

  private throwV2Error(
    error: {
      code: string;
      message: string;
      tags?: ReadonlyArray<string>;
      details?: Readonly<Record<string, unknown>>;
    },
    status: number
  ): never {
    throw new CustomHttpException(error.message, getDefaultCodeByStatus(status), {
      domainCode: error.code,
      domainTags: error.tags,
      details: error.details,
    });
  }

  private getUndoRedoEnginePreferenceKey(
    tableId: string
  ): ReturnType<typeof buildUndoRedoEnginePreferenceKey> | null {
    const userId = this.cls.get('user.id');
    const windowId = this.cls.get('windowId');

    if (!userId || !windowId) {
      return null;
    }

    return buildUndoRedoEnginePreferenceKey(userId, tableId, windowId);
  }

  private async preferLegacyUndoEngine(tableId: string): Promise<void> {
    const key = this.getUndoRedoEnginePreferenceKey(tableId);
    if (!key) {
      return;
    }

    await this.cacheService.setDetail(key, 'v1', UNDO_REDO_ENGINE_PREFERENCE_TTL_SECONDS);
  }

  private async clearUndoRedoEnginePreference(tableId: string): Promise<void> {
    const key = this.getUndoRedoEnginePreferenceKey(tableId);
    if (!key) {
      return;
    }

    await this.cacheService.del(key);
  }

  private mergeDuplicateRecordUpdates(
    records: NonNullable<IUpdateRecordsRo['records']>
  ): NonNullable<IUpdateRecordsRo['records']> {
    const mergedById = new Map<string, NonNullable<IUpdateRecordsRo['records']>[number]>();
    const order: string[] = [];

    for (const record of records) {
      const existing = mergedById.get(record.id);
      if (!existing) {
        order.push(record.id);
        mergedById.set(record.id, {
          id: record.id,
          fields: { ...record.fields },
        });
        continue;
      }

      mergedById.set(record.id, {
        id: record.id,
        fields: {
          ...existing.fields,
          ...record.fields,
        },
      });
    }

    return order
      .map((recordId) => mergedById.get(recordId))
      .filter((record): record is NonNullable<IUpdateRecordsRo['records']>[number] =>
        Boolean(record)
      );
  }

  async getRecords(tableId: string, query: IGetRecordsRo): Promise<IRecordsVo> {
    if (query.filterLinkCellSelected && query.filterLinkCellCandidate) {
      this.throwV2Error(
        {
          code: invalidFilterCode,
          message:
            'filterLinkCellSelected and filterLinkCellCandidate can not be set at the same time',
          tags: ['validation'],
        },
        HttpStatus.BAD_REQUEST
      );
    }

    const context = await this.createV2ReadContext(tableId, query);
    const enabledFieldIds = (
      context as IExecutionContext & {
        recordReadQuerySource?: { enabledFieldIds?: string[] };
      }
    ).recordReadQuerySource?.enabledFieldIds;
    const effectiveQuery = {
      ...query,
      ...this.sanitizeReadableSortAndGroup(query, enabledFieldIds),
    } satisfies IGetRecordsRo;

    const requestedFieldKeyType = query.fieldKeyType ?? FieldKeyType.Name;
    const snapshotProjection = await this.resolveSnapshotProjection(
      tableId,
      query,
      requestedFieldKeyType
    );
    const normalizedFilter = await this.normalizeFilterForV2(tableId, query.filter);
    const sortWithGroupFallback = this.mergeGroupByIntoSort(
      effectiveQuery.groupBy,
      effectiveQuery.orderBy
    );
    const normalizedSort = sortWithGroupFallback?.map((item) => ({
      fieldId: item.fieldId,
      order: item.order,
    }));
    const normalizedGroupBy = effectiveQuery.groupBy?.map((item) => item.fieldId);
    const queryExtra = this.shouldLoadQueryExtra(effectiveQuery)
      ? await this.getQueryExtra(tableId, effectiveQuery)
      : undefined;

    const container = await this.v2ContainerService.getContainer();
    const queryBus = container.resolve<IQueryBus>(v2CoreTokens.queryBus);
    const pageResult = await this.executeListRecordsEndpoint(
      {
        tableId,
        // FieldKeyPipe has normalized request field keys to ids.
        fieldKeyType: FieldKeyType.Id,
        limit: query.take,
        offset: query.skip,
        ...(normalizedFilter ? { filter: normalizedFilter } : {}),
        ...(normalizedSort?.length ? { sort: normalizedSort } : {}),
        ...(normalizedGroupBy?.length ? { groupBy: normalizedGroupBy } : {}),
        ...(effectiveQuery.search ? { search: effectiveQuery.search } : {}),
        ...(effectiveQuery.filterLinkCellSelected
          ? { filterLinkCellSelected: effectiveQuery.filterLinkCellSelected }
          : {}),
        ...(effectiveQuery.filterLinkCellCandidate
          ? { filterLinkCellCandidate: effectiveQuery.filterLinkCellCandidate }
          : {}),
        ...(effectiveQuery.selectedRecordIds?.length
          ? { selectedRecordIds: effectiveQuery.selectedRecordIds }
          : {}),
        ...(effectiveQuery.viewId ? { viewId: effectiveQuery.viewId } : {}),
        ...(effectiveQuery.ignoreViewQuery !== undefined
          ? { ignoreViewQuery: effectiveQuery.ignoreViewQuery }
          : {}),
      },
      context,
      queryBus
    );
    const orderedRecords = pageResult.records;

    if (orderedRecords.length === 0) {
      return queryExtra ? { records: [], extra: queryExtra } : { records: [] };
    }

    const recordIds = orderedRecords.map((record) => record.id);
    const snapshots = await this.recordService.getSnapshotBulkWithPermission(
      tableId,
      recordIds,
      snapshotProjection,
      requestedFieldKeyType,
      query.cellFormat,
      true
    );

    if (snapshots.length !== recordIds.length) {
      throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
    }

    const snapshotMap = new Map(
      snapshots.map((snapshot) => [snapshot.data.id, snapshot.data as IRecord])
    );
    const records = recordIds
      .map((recordId) => snapshotMap.get(recordId))
      .filter((record): record is IRecord => Boolean(record));

    if (records.length !== recordIds.length) {
      throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
    }

    const normalizedRecords = await this.formatSystemDatetimeFields(
      tableId,
      records,
      query.cellFormat,
      sortWithGroupFallback?.map((item) => item.fieldId)
    );

    return queryExtra
      ? { records: normalizedRecords, extra: queryExtra }
      : { records: normalizedRecords };
  }

  private async formatSystemDatetimeFields(
    tableId: string,
    records: IRecord[],
    cellFormat?: CellFormat,
    sortedFieldIds?: ReadonlyArray<string>
  ): Promise<IRecord[]> {
    if (!records.length || cellFormat === CellFormat.Text || !sortedFieldIds?.length) {
      return records;
    }

    const sortedFieldIdSet = new Set(sortedFieldIds);
    const fields = await this.fieldService.getFieldsByQuery(tableId);
    const formatters = fields.flatMap((field) => {
      if (!sortedFieldIdSet.has(field.id)) {
        return [];
      }
      if (field.type !== FieldType.CreatedTime && field.type !== FieldType.LastModifiedTime) {
        return [];
      }

      const formatting = this.extractDatetimeFormatting(field.options);
      if (!formatting || formatting.time !== TimeFormatting.None) {
        return [];
      }

      return [
        {
          topLevelKey:
            field.type === FieldType.CreatedTime
              ? ('createdTime' as const)
              : ('lastModifiedTime' as const),
          formatting,
        },
      ];
    });

    if (!formatters.length) {
      return records;
    }

    return records.map((record) => {
      let nextRecord: IRecord | undefined;

      for (const formatter of formatters) {
        const topLevelValue = record[formatter.topLevelKey];
        if (typeof topLevelValue === 'string') {
          const formattedTopLevel = formatDateToString(topLevelValue, formatter.formatting);
          if (formattedTopLevel !== topLevelValue) {
            nextRecord ??= { ...record };
            nextRecord[formatter.topLevelKey] = formattedTopLevel;
          }
        }
      }

      return nextRecord ?? record;
    });
  }

  private extractDatetimeFormatting(options: unknown): IDatetimeFormatting | undefined {
    if (!options || typeof options !== 'object' || !('formatting' in options)) {
      return undefined;
    }

    const formatting = options.formatting;
    if (!formatting || typeof formatting !== 'object') {
      return undefined;
    }

    return formatting as IDatetimeFormatting;
  }

  private toProjectionMap(fieldKeys?: string | string[]): Record<string, boolean> | undefined {
    if (!fieldKeys) {
      return undefined;
    }
    const keys = (Array.isArray(fieldKeys) ? fieldKeys : [fieldKeys]).filter(
      (key): key is string => typeof key === 'string' && key.length > 0
    );
    if (!keys.length) {
      return undefined;
    }
    return keys.reduce<Record<string, boolean>>((acc, key) => {
      acc[key] = true;
      return acc;
    }, {});
  }

  private async resolveSnapshotProjection(
    tableId: string,
    query: IGetRecordsRo,
    fieldKeyType: FieldKeyType
  ): Promise<Record<string, boolean> | undefined> {
    const explicitProjection = this.toProjectionMap(
      query.projection as unknown as string | string[]
    );
    if (explicitProjection) {
      return explicitProjection;
    }

    if (query.ignoreViewQuery || !query.viewId) {
      return undefined;
    }

    const visibleFields = await this.fieldService.getFieldsByQuery(tableId, {
      viewId: query.viewId,
      filterHidden: true,
    });

    const projectionKeys = visibleFields
      .map((field) => {
        if (fieldKeyType === FieldKeyType.Id) {
          return field.id;
        }
        if (fieldKeyType === FieldKeyType.Name) {
          return field.name;
        }
        return field.dbFieldName || field.name;
      })
      .filter((key): key is string => Boolean(key));

    return this.toProjectionMap(projectionKeys);
  }

  private async executeListRecordsEndpoint(
    input: IListTableRecordsQueryInput,
    context: IExecutionContext,
    queryBus: IQueryBus
  ): Promise<{
    records: Array<{ id: string; fields: Record<string, unknown> }>;
    pagination: { hasMore: boolean };
  }> {
    const result = await executeListTableRecordsEndpoint(context, input, queryBus);
    if (result.status === 200 && result.body.ok) {
      return {
        records: result.body.data.records as Array<{ id: string; fields: Record<string, unknown> }>,
        pagination: {
          hasMore: result.body.data.pagination.hasMore,
        },
      };
    }

    if (!result.body.ok) {
      this.throwV2Error(result.body.error, result.status);
    }

    throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  private async createV2ReadContext(
    tableId: string,
    query: Pick<IGetRecordsRo, 'viewId' | 'ignoreViewQuery' | 'filterLinkCellSelected'>
  ): Promise<IExecutionContext> {
    const context = await this.v2ContextFactory.createContext();
    const readSource = await this.recordPermissionService.getReadQuerySource(tableId, {
      viewId: query.viewId,
      keepPrimaryKey: Boolean(query.filterLinkCellSelected),
    });
    if (!readSource) {
      return context;
    }
    return {
      ...context,
      recordReadQuerySource: {
        tableName: readSource.tableName,
        cteName: readSource.cteName,
        cteSql: readSource.cteSql,
        enabledFieldIds: readSource.enabledFieldIds,
      },
    } as IExecutionContext;
  }

  private sanitizeReadableSortAndGroup(
    query: Pick<IGetRecordsRo, 'orderBy' | 'groupBy'>,
    enabledFieldIds?: string[]
  ): Pick<IGetRecordsRo, 'orderBy' | 'groupBy'> {
    if (!enabledFieldIds?.length) {
      return {
        orderBy: query.orderBy,
        groupBy: query.groupBy,
      };
    }

    const enabledFieldIdSet = new Set(enabledFieldIds);
    const orderBy = query.orderBy?.filter((item) => enabledFieldIdSet.has(item.fieldId));
    const groupBy = query.groupBy?.filter((item) => enabledFieldIdSet.has(item.fieldId));

    return {
      orderBy: orderBy?.length ? orderBy : undefined,
      groupBy: groupBy?.length ? groupBy : undefined,
    };
  }

  private shouldLoadQueryExtra(query: IGetRecordsRo): boolean {
    return Boolean(query.search || query.groupBy?.length || query.collapsedGroupIds?.length);
  }

  private async getQueryExtra(
    tableId: string,
    query: IGetRecordsRo
  ): Promise<IRecordsVo['extra'] | undefined> {
    const result = await this.recordService.getDocIdsByQuery(
      tableId,
      {
        fieldKeyType: FieldKeyType.Id,
        ignoreViewQuery: query.ignoreViewQuery ?? false,
        viewId: query.viewId,
        filter: query.filter,
        orderBy: query.orderBy,
        search: query.search,
        groupBy: query.groupBy,
        collapsedGroupIds: query.collapsedGroupIds,
        projection: query.projection,
        skip: query.skip,
        take: query.take,
      },
      true
    );
    return result.extra;
  }

  async updateRecord(
    tableId: string,
    recordId: string,
    updateRecordRo: IUpdateRecordRo
  ): Promise<IRecord> {
    const order = updateRecordRo.order;
    const hasOrder = Boolean(order);
    const fields = updateRecordRo.record.fields ?? {};
    const hasFields = Object.keys(fields).length > 0;

    const container = await this.v2ContainerService.getContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext();

    if (hasFields) {
      // Convert v1 input format to v2 format
      // v1: { record: { fields: { fieldKey: value } } }
      // v2: { tableId, recordId, fields: { fieldId: value } }
      // v1 stores select field values by name, v2 stores by id
      // Preserve v1's default typecast behavior (false) to ensure proper validation
      const v2Input = {
        tableId,
        recordId,
        fields,
        typecast: updateRecordRo.typecast ?? false,
        fieldKeyType: updateRecordRo.fieldKeyType,
        ...(order
          ? {
              order: {
                viewId: order.viewId,
                anchorId: order.anchorId,
                position: order.position,
              },
            }
          : {}),
      };

      const result = await executeUpdateRecordEndpoint(context, v2Input, commandBus);
      if (!(result.status === 200 && result.body.ok)) {
        if (!result.body.ok) {
          this.throwV2Error(result.body.error, result.status);
        }
        throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
      }

      await this.clearUndoRedoEnginePreference(tableId);
    }

    if (!hasFields && hasOrder && order) {
      const reorderResult = await executeReorderRecordsEndpoint(
        context,
        {
          tableId,
          recordIds: [recordId],
          order: {
            viewId: order.viewId,
            anchorId: order.anchorId,
            position: order.position,
          },
        },
        commandBus
      );
      if (!(reorderResult.status === 200 && reorderResult.body.ok)) {
        if (!reorderResult.body.ok) {
          this.throwV2Error(reorderResult.body.error, reorderResult.status);
        }
        throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
      }

      await this.clearUndoRedoEnginePreference(tableId);
    }

    if (hasFields || hasOrder) {
      const snapshots = await this.recordService.getSnapshotBulkWithPermission(
        tableId,
        [recordId],
        undefined,
        updateRecordRo.fieldKeyType || FieldKeyType.Name,
        undefined,
        true
      );

      if (snapshots.length === 1) {
        return snapshots[0].data as IRecord;
      }

      throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
    }
    throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  async updateRecords(tableId: string, updateRecordsRo: IUpdateRecordsRo): Promise<IRecord[]> {
    const rawRecords = updateRecordsRo.records ?? [];
    const records = this.mergeDuplicateRecordUpdates(rawRecords);
    const recordIds = records.map((record) => record.id);
    if (recordIds.length === 0) {
      return [];
    }

    const container = await this.v2ContainerService.getContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext();
    const updateResult = await executeUpdateRecordsEndpoint(
      context,
      {
        tableId,
        records,
        typecast: updateRecordsRo.typecast ?? false,
        fieldKeyType: updateRecordsRo.fieldKeyType ?? FieldKeyType.Name,
        ...(updateRecordsRo.order ? { order: updateRecordsRo.order } : {}),
      },
      commandBus
    );
    if (!(updateResult.status === 200 && updateResult.body.ok)) {
      if (!updateResult.body.ok) {
        this.throwV2Error(updateResult.body.error, updateResult.status);
      }
      throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
    }

    await this.clearUndoRedoEnginePreference(tableId);

    const snapshots = await this.recordService.getSnapshotBulkWithPermission(
      tableId,
      recordIds,
      undefined,
      updateRecordsRo.fieldKeyType || FieldKeyType.Name,
      undefined,
      true
    );

    if (snapshots.length !== recordIds.length) {
      throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
    }

    const snapshotMap = new Map(snapshots.map((snapshot) => [snapshot.data.id, snapshot.data]));
    const resultRecords = recordIds
      .map((recordId) => snapshotMap.get(recordId))
      .filter((record): record is IRecord => Boolean(record));

    if (resultRecords.length !== recordIds.length) {
      throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
    }

    return resultRecords;
  }

  async createRecords(
    tableId: string,
    createRecordsRo: ICreateRecordsRo,
    isAiInternal?: string
  ): Promise<ICreateRecordsVo> {
    const container = await this.v2ContainerService.getContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext();

    // Preserve v1's default typecast behavior (false) to ensure proper validation
    const records = createRecordsRo.records;

    const result = await executeCreateRecordsEndpoint(
      context,
      {
        tableId,
        records,
        typecast: createRecordsRo.typecast ?? false,
        fieldKeyType: createRecordsRo.fieldKeyType,
        order: createRecordsRo.order,
      },
      commandBus
    );

    if (result.status === 201 && result.body.ok) {
      await this.clearUndoRedoEnginePreference(tableId);

      const recordIds = result.body.data.records.map((record) => record.id);
      if (recordIds.length === 0) {
        return { records: [] };
      }

      const snapshots = await this.recordService.getSnapshotBulkWithPermission(
        tableId,
        recordIds,
        undefined,
        createRecordsRo.fieldKeyType || FieldKeyType.Name,
        undefined,
        true
      );

      if (snapshots.length !== recordIds.length) {
        throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
      }

      const snapshotMap = new Map(snapshots.map((snapshot) => [snapshot.data.id, snapshot.data]));
      const resultRecords = recordIds
        .map((recordId) => snapshotMap.get(recordId))
        .filter((record): record is IRecord => Boolean(record));

      if (resultRecords.length !== recordIds.length) {
        throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
      }

      return { records: resultRecords };
    }

    if (!result.body.ok) {
      this.throwV2Error(result.body.error, result.status);
    }

    throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  async formSubmit(tableId: string, formSubmitRo: IFormSubmitRo): Promise<IRecord> {
    const container = await this.v2ContainerService.getContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext();

    const result = await executeSubmitRecordEndpoint(
      context,
      {
        tableId,
        formId: formSubmitRo.viewId,
        fields: formSubmitRo.fields,
        typecast: formSubmitRo.typecast ?? false,
      },
      commandBus
    );

    if (result.status === 201 && result.body.ok) {
      await this.clearUndoRedoEnginePreference(tableId);

      const recordId = result.body.data.record.id;
      const snapshots = await this.recordService.getSnapshotBulkWithPermission(
        tableId,
        [recordId],
        undefined,
        FieldKeyType.Id,
        undefined,
        true
      );

      if (snapshots.length !== 1) {
        throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
      }

      return snapshots[0].data as IRecord;
    }

    if (!result.body.ok) {
      this.throwV2Error(result.body.error, result.status);
    }

    throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  async paste(
    tableId: string,
    pasteRo: IPasteRo,
    options?: {
      updateFilter?: IFilterSet | null;
      windowId?: string;
      allowFieldExpansion?: boolean;
      allowRecordExpansion?: boolean;
    }
  ): Promise<IPasteVo> {
    const container = await this.v2ContainerService.getContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext();
    (
      context as IExecutionContext & {
        [V2_RECORD_PASTE_AUDIT_CONTEXT_KEY]?: boolean;
      }
    )[V2_RECORD_PASTE_AUDIT_CONTEXT_KEY] = true;
    const windowId = options?.windowId;
    const tracer = trace.getTracer('default');

    // Convert v1 input format to v2 format
    // v1 ranges format depends on type:
    // - default (cell range): [[startCol, startRow], [endCol, endRow]]
    // - columns: [[startCol, endCol]] - single element array
    // - rows: [[startRow, endRow]] - single element array
    // v2 now supports type parameter directly and handles the conversion internally
    const {
      ranges,
      content,
      viewId,
      header,
      type,
      projection,
      filter,
      orderBy,
      groupBy,
      collapsedGroupIds,
      search,
      ignoreViewQuery,
    } = pasteRo;

    let fallbackRanges: IPasteVo['ranges'] | null = null;
    let v2Input: unknown;
    let finalContent: unknown[][] = [];
    let startCol = 0;
    let startRow = 0;
    let truncatedRows = 0;

    await tracer.startActiveSpan('teable.paste.v2.prepare', async (span) => {
      try {
        // Parse content if it's a string (tab-separated values)
        let parsedContent: unknown[][] =
          typeof content === 'string' ? this.parseCopyContent(content) : content;

        // Get permissions to check for field|create and record|create
        const permissions = this.cls.get('permissions') ?? [];
        const hasFieldCreatePermission =
          options?.allowFieldExpansion ?? permissions.includes('field|create');
        const hasRecordCreatePermission =
          options?.allowRecordExpansion ?? permissions.includes('record|create');

        // Get table size to calculate expansion needs
        const rangeQuery = await this.normalizeRangeQuery(tableId, {
          viewId,
          filter,
          search,
          groupBy,
          orderBy,
          collapsedGroupIds,
          ignoreViewQuery,
        });
        const queryRo = {
          viewId: rangeQuery.viewId,
          ignoreViewQuery: rangeQuery.ignoreViewQuery,
          filter: rangeQuery.filter,
          projection,
          orderBy: rangeQuery.orderBy,
          groupBy: rangeQuery.groupBy,
          collapsedGroupIds,
          search,
        };

        const fields = await this.fieldService.getFieldInstances(tableId, {
          viewId: rangeQuery.viewId,
          filterHidden: true,
          projection,
        });
        const { rowCount: rowCountInView } = await this.aggregationService.performRowCount(
          tableId,
          queryRo
        );

        const tableSize: [number, number] = [fields.length, rowCountInView];

        // Calculate start cell based on range type
        if (type === 'columns') {
          startCol = ranges[0]![0];
          startRow = 0;
        } else if (type === 'rows') {
          startCol = 0;
          startRow = ranges[0]![0];
        } else {
          startCol = ranges[0]![0];
          startRow = ranges[0]![1];
        }

        // Expand paste content to fill selection (matches V1 behavior)
        parsedContent = this.expandPasteContent(
          parsedContent,
          type,
          ranges,
          tableSize[0],
          tableSize[1],
          startCol,
          startRow
        );

        const contentCols = parsedContent[0]?.length ?? 0;
        const contentRows = parsedContent.length;

        // Calculate expansion needs
        const numColsToExpand = Math.max(0, startCol + contentCols - tableSize[0]);
        const numRowsToExpand = Math.max(0, startRow + contentRows - tableSize[1]);

        // Apply permission-based limits (like V1's calculateExpansion)
        const effectiveColsToExpand = hasFieldCreatePermission ? numColsToExpand : 0;
        const effectiveRowsToExpand = hasRecordCreatePermission ? numRowsToExpand : 0;

        // When paste needs to create new fields, fall back to V1's paste implementation.
        // V2's paste doesn't support field creation, and mixing V2 record operations with
        // V1 field operations causes database lock conflicts during undo.
        if (effectiveColsToExpand > 0) {
          fallbackRanges = await this.selectionService.paste(tableId, pasteRo, {
            windowId,
          });
          await this.preferLegacyUndoEngine(tableId);
          return;
        }

        // Truncate content if expansion is not allowed
        finalContent = parsedContent;
        const maxCols = tableSize[0] - startCol + effectiveColsToExpand;
        const maxRows = tableSize[1] - startRow + effectiveRowsToExpand;

        // Track if we need to adjust ranges due to truncation
        let truncatedCols = contentCols;
        truncatedRows = contentRows;

        if (contentCols > maxCols || contentRows > maxRows) {
          truncatedRows = Math.min(contentRows, maxRows);
          truncatedCols = Math.min(contentCols, maxCols);
          finalContent = parsedContent
            .slice(0, truncatedRows)
            .map((row) => row.slice(0, truncatedCols));
        }

        // Adjust ranges to match truncated content (prevents V2 core from re-expanding)
        let adjustedRanges = ranges;
        if (type === undefined && finalContent.length > 0 && finalContent[0]?.length > 0) {
          // For cell type, adjust end position to match truncated content
          const adjustedEndCol = startCol + truncatedCols - 1;
          const adjustedEndRow = startRow + truncatedRows - 1;
          adjustedRanges = [
            [startCol, startRow],
            [adjustedEndCol, adjustedEndRow],
          ];
        }

        // Convert header to sourceFields format if provided
        const sourceFields = header?.map((field) => ({
          name: field.name,
          type: field.type,
          cellValueType: field.cellValueType,
          isComputed: field.isComputed,
          isLookup: field.isLookup,
          isMultipleCellValue: field.isMultipleCellValue,
          options: field.options,
        }));

        const normalizedFilter = await this.normalizeFilterForV2(tableId, queryRo.filter);
        const normalizedUpdateFilter = options?.updateFilter
          ? await this.normalizeFilterForV2(tableId, options.updateFilter)
          : undefined;
        const sortWithGroupFallback = this.mergeGroupByIntoSort(
          rangeQuery.groupBy,
          rangeQuery.orderBy
        );
        v2Input = {
          tableId,
          viewId: rangeQuery.viewId,
          ranges: adjustedRanges,
          content: finalContent,
          typecast: true,
          sourceFields,
          type, // Pass type to v2 for internal handling
          projection,
          // Let v2 core interpret the legacy search tuple via RecordSearch so
          // search-aware row mapping and field/operator compatibility stay aligned.
          filter: normalizedFilter,
          search: rangeQuery.search,
          updateFilter: normalizedUpdateFilter,
          sort: sortWithGroupFallback,
          groupBy: rangeQuery.groupBy?.map((item) => ({
            fieldId: item.fieldId,
            order: item.order,
          })),
          ignoreViewQuery: rangeQuery.ignoreViewQuery,
        };
      } finally {
        span.end();
      }
    });

    if (fallbackRanges) {
      return { ranges: fallbackRanges };
    }

    if (!v2Input) {
      throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
    }

    const result = await executePasteEndpoint(context, v2Input, commandBus);

    if (result.status === 200 && result.body.ok) {
      await this.clearUndoRedoEnginePreference(tableId);

      // V2 returns { updatedCount, createdCount, createdRecordIds }
      // V1 expects { ranges: [[startCol, startRow], [endCol, endRow]] }
      // Use truncatedRows (content size) for range calculation, not operation count,
      // because some rows may be skipped due to permission filters
      const finalCols = finalContent[0]?.length ?? 1;

      // Note: Record creation undo/redo is handled by V2's RecordsBatchCreated projection handler
      // Field creation case is handled by V1 fallback above

      // Best-effort: normalize v1 range formats (cell/rows/columns) into a cell range.
      // v1 "ranges" uses `cellSchema` for all modes:
      // - default: [col, row]
      // - columns: [startCol, endCol]
      // - rows: [startRow, endRow]
      if (type === 'columns') {
        const endCol = startCol + finalCols - 1;
        return {
          ranges: [
            [startCol, 0],
            [endCol, Math.max(truncatedRows - 1, 0)],
          ],
        };
      }

      if (type === 'rows') {
        const endRow = ranges[0]![1];
        return {
          ranges: [
            [0, startRow],
            [Math.max(finalCols - 1, 0), endRow],
          ],
        };
      }

      const endRow = startRow + Math.max(truncatedRows - 1, 0);
      const endCol = startCol + finalCols - 1;
      return {
        ranges: [
          [startCol, startRow],
          [endCol, Math.max(endRow, startRow)],
        ],
      };
    }

    if (!result.body.ok) {
      this.throwV2Error(result.body.error, result.status);
    }

    throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  /**
   * Expand paste content to fill target selection (matches V1 behavior).
   * If the selection is a multiple of the content size, the content is tiled.
   */
  private expandPasteContent(
    content: unknown[][],
    type: 'columns' | 'rows' | undefined,
    ranges: [number, number][],
    totalCols: number,
    totalRows: number,
    startCol: number,
    startRow: number
  ): unknown[][] {
    if (content.length === 0 || content[0]?.length === 0) {
      return content;
    }

    const contentRows = content.length;
    const contentCols = content[0]!.length;

    // Calculate target range size
    let targetRows: number;
    let targetCols: number;

    if (type === 'columns') {
      const endCol = ranges[0]![1];
      targetCols = endCol - startCol + 1;
      targetRows = totalRows;
    } else if (type === 'rows') {
      const endRow = ranges[0]![1];
      targetRows = endRow - startRow + 1;
      targetCols = totalCols;
    } else {
      // Cell range: [[startCol, startRow], [endCol, endRow]]
      const endCol = ranges[1]?.[0] ?? startCol;
      const endRow = ranges[1]?.[1] ?? startRow;
      targetCols = endCol - startCol + 1;
      targetRows = endRow - startRow + 1;
    }

    // If target equals content size, no expansion needed
    if (targetRows === contentRows && targetCols === contentCols) {
      return content;
    }

    // Only expand if target is an exact multiple of content dimensions
    if (targetRows % contentRows !== 0 || targetCols % contentCols !== 0) {
      return content;
    }

    // Tile content to fill the target range
    return Array.from({ length: targetRows }, (_, rowIdx) =>
      Array.from(
        { length: targetCols },
        (_, colIdx) => content[rowIdx % contentRows]![colIdx % contentCols]
      )
    );
  }

  async clear(tableId: string, rangesRo: IRangesRo): Promise<null> {
    const container = await this.v2ContainerService.getContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext();

    const rangeQuery = await this.normalizeRangeQuery(tableId, rangesRo);
    const normalizedFilter = await this.normalizeFilterForV2(tableId, rangeQuery.filter);
    const sortWithGroupFallback = this.mergeGroupByIntoSort(rangeQuery.groupBy, rangeQuery.orderBy);
    const v2Input = {
      tableId,
      viewId: rangeQuery.viewId,
      ranges: rangesRo.ranges,
      type: rangesRo.type,
      projection: rangesRo.projection,
      filter: normalizedFilter,
      search: rangeQuery.search,
      sort: sortWithGroupFallback,
      groupBy: rangeQuery.groupBy?.map((item) => ({
        fieldId: item.fieldId,
        order: item.order,
      })),
      ignoreViewQuery: rangeQuery.ignoreViewQuery,
    };

    const result = await executeClearEndpoint(context, v2Input, commandBus);

    if (result.status === 200 && result.body.ok) {
      await this.clearUndoRedoEnginePreference(tableId);

      // V1 clear returns null
      return null;
    }

    if (!result.body.ok) {
      this.throwV2Error(result.body.error, result.status);
    }

    throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  /**
   * Get record IDs from ranges for undo/redo support and permission checks.
   * This method queries the record IDs that will be affected by a range-based operation.
   */
  async getRecordIdsFromRanges(tableId: string, rangesRo: IRangesRo): Promise<string[]> {
    const {
      ranges,
      type,
      viewId,
      filter,
      orderBy,
      search,
      groupBy,
      collapsedGroupIds,
      ignoreViewQuery,
    } = rangesRo;

    const baseQuery = {
      viewId,
      ignoreViewQuery,
      filter,
      orderBy,
      search,
      groupBy,
      collapsedGroupIds,
      fieldKeyType: FieldKeyType.Id,
    };
    const maxBatchSize = 1000;

    const fetchRecordIdsByRange = async (start: number, end: number): Promise<string[]> => {
      const total = end - start + 1;
      if (total <= 0) {
        return [];
      }

      let recordIds: string[] = [];
      for (let offset = 0; offset < total; offset += maxBatchSize) {
        const take = Math.min(maxBatchSize, total - offset);
        const result = await this.recordService.getDocIdsByQuery(
          tableId,
          {
            ...baseQuery,
            skip: start + offset,
            take,
          },
          true
        );
        recordIds = recordIds.concat(result.ids);
        if (result.ids.length < take) {
          break;
        }
      }
      return recordIds;
    };

    if (type === RangeType.Columns) {
      // For columns selection, get all record IDs
      const result = await this.recordService.getDocIdsByQuery(
        tableId,
        { ...baseQuery, skip: 0, take: -1 },
        true
      );
      return result.ids;
    }

    if (type === RangeType.Rows) {
      // For rows selection, iterate through each range [start, end]
      let recordIds: string[] = [];
      for (const [start, end] of ranges) {
        recordIds = recordIds.concat(await fetchRecordIdsByRange(start, end));
      }
      return recordIds;
    }

    // Default: cell range - ranges is [[startCol, startRow], [endCol, endRow]]
    const [start, end] = ranges;
    return fetchRecordIdsByRange(start[1], end[1]);
  }

  async deleteByRange(
    tableId: string,
    rangesRo: IRangesRo,
    _windowId?: string
  ): Promise<{ ids: string[] }> {
    const container = await this.v2ContainerService.getContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext();

    const rangeQuery = await this.normalizeRangeQuery(tableId, rangesRo);
    const sortWithGroupFallback = this.mergeGroupByIntoSort(rangeQuery.groupBy, rangeQuery.orderBy);

    // Build v2 deleteByRange input
    const v2Input = {
      tableId,
      viewId: rangeQuery.viewId,
      ranges: rangesRo.ranges,
      type: rangesRo.type,
      filter: await this.normalizeFilterForV2(tableId, rangeQuery.filter),
      sort: sortWithGroupFallback?.map((item) => ({
        fieldId: item.fieldId,
        order: item.order,
      })),
      search: rangeQuery.search,
      groupBy: rangeQuery.groupBy?.map((item) => ({
        fieldId: item.fieldId,
        order: item.order,
      })),
      ignoreViewQuery: rangeQuery.ignoreViewQuery,
    };

    const result = await executeDeleteByRangeEndpoint(context, v2Input, commandBus);

    if (result.status === 200 && result.body.ok) {
      await this.clearUndoRedoEnginePreference(tableId);

      // V2's DeleteByRangeHandler captures snapshots and emits RecordsDeleted event.
      // Undo/redo is handled directly by v2 command replay.
      return { ids: [...result.body.data.deletedRecordIds] };
    }

    if (!result.body.ok) {
      this.throwV2Error(result.body.error, result.status);
    }

    throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  async deleteRecords(
    tableId: string,
    recordIds: string[],
    _windowId?: string
  ): Promise<IRecordsVo> {
    const container = await this.v2ContainerService.getContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext();

    // Query records before deletion to return them in V1 format
    const recordSnapshots = await this.recordService.getSnapshotBulkWithPermission(
      tableId,
      recordIds,
      undefined,
      FieldKeyType.Id,
      undefined,
      true
    );

    const v2Input = {
      tableId,
      recordIds,
    };

    const result = await executeDeleteRecordsEndpoint(context, v2Input, commandBus);

    if (result.status === 200 && result.body.ok) {
      await this.clearUndoRedoEnginePreference(tableId);

      // Return records that were deleted (V1 format)
      return {
        records: recordSnapshots.map((snapshot) => snapshot.data as IRecord),
      };
    }

    if (!result.body.ok) {
      this.throwV2Error(result.body.error, result.status);
    }

    throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  /**
   * Parse tab-separated content string into 2D array
   */
  private parseCopyContent(content: string): unknown[][] {
    return parseClipboardText(content);
  }

  private async resolveViewId(tableId: string, viewId?: string | null): Promise<string> {
    if (viewId) {
      return viewId;
    }
    const defaultView = await this.tableService.getDefaultViewId(tableId);
    return defaultView.id;
  }

  private async normalizeRangeQuery(
    tableId: string,
    query: Pick<
      IRangesRo,
      | 'viewId'
      | 'filter'
      | 'search'
      | 'groupBy'
      | 'orderBy'
      | 'collapsedGroupIds'
      | 'ignoreViewQuery'
    >
  ): Promise<{
    viewId: string;
    filter: IFilter | null | undefined;
    search: IRangesRo['search'];
    orderBy: IRangesRo['orderBy'];
    groupBy: IRangesRo['groupBy'];
    ignoreViewQuery: boolean;
  }> {
    const resolvedViewId = await this.resolveViewId(tableId, query.viewId);
    const filterWithCollapsed = await this.buildRangeFilter(tableId, {
      viewId: resolvedViewId,
      filter: query.filter,
      search: query.search,
      groupBy: query.groupBy,
      collapsedGroupIds: query.collapsedGroupIds,
      ignoreViewQuery: query.ignoreViewQuery,
    });

    return {
      viewId: resolvedViewId,
      filter: filterWithCollapsed,
      search: query.search,
      orderBy: query.orderBy,
      groupBy: query.groupBy,
      ignoreViewQuery: query.ignoreViewQuery ?? false,
    };
  }

  /**
   * V1 selection APIs derive row offsets from `groupBy + orderBy`.
   * Keep the same effective sort in v2 input so row targeting remains stable
   * even when intermediate adapters fail to carry `groupBy`.
   */
  private mergeGroupByIntoSort(
    groupBy?: IRangesRo['groupBy'],
    orderBy?: IRangesRo['orderBy']
  ): IRangesRo['orderBy'] {
    const merged = [...(groupBy ?? []), ...(orderBy ?? [])];
    if (!merged.length) {
      return undefined;
    }

    const deduplicated = merged.filter(
      (item, index, list) =>
        list.findIndex((candidate) => candidate.fieldId === item.fieldId) === index
    );

    return deduplicated.length ? deduplicated : undefined;
  }

  private async buildRangeFilter(
    tableId: string,
    query: {
      viewId: string;
      filter?: IFilter | null;
      search?: IRangesRo['search'];
      groupBy?: IRangesRo['groupBy'];
      collapsedGroupIds?: string[];
      ignoreViewQuery?: boolean;
    }
  ): Promise<IFilter | null | undefined> {
    const normalizedGroupBy = query.groupBy ?? undefined;
    if (!normalizedGroupBy?.length || !query.collapsedGroupIds?.length) {
      return query.filter;
    }
    const normalizedSearch = this.normalizeGroupRelatedSearch(query.search);
    const normalizedFilter = query.filter ?? undefined;

    const { filter } = await this.recordService.getGroupRelatedData(tableId, {
      viewId: query.viewId,
      ignoreViewQuery: query.ignoreViewQuery ?? false,
      filter: normalizedFilter,
      search: normalizedSearch,
      groupBy: normalizedGroupBy,
      collapsedGroupIds: query.collapsedGroupIds,
    });

    return filter;
  }

  private normalizeGroupRelatedSearch(search?: IRangesRo['search']): IGetRecordsRo['search'] {
    if (!search) {
      return undefined;
    }

    const [searchValue, fieldId, hideNotMatch] = search;
    if (fieldId == null) {
      return [searchValue];
    }
    if (hideNotMatch == null) {
      return [searchValue, fieldId];
    }
    return [searchValue, fieldId, hideNotMatch];
  }

  private async normalizeFilterForV2(
    tableId: string,
    filter: unknown
  ): Promise<RecordFilter | undefined | null> {
    const mapped = this.mapV1FilterToV2(filter);
    if (!mapped) {
      return mapped;
    }

    const fields = await this.fieldService.getFieldInstances(tableId, { filterHidden: true });
    const fieldMetaMap = new Map(
      fields.map((field) => [
        field.id,
        {
          type: field.type,
          cellValueType: field.cellValueType,
        },
      ])
    );
    const currentUserId = this.cls.get('user.id');

    const normalizeNode = (node: RecordFilterNode): RecordFilterNode | null => {
      if ('not' in node) {
        const next = normalizeNode(node.not);
        if (!next) return null;
        return { not: next };
      }

      if ('items' in node) {
        const items = node.items
          .map((item) => normalizeNode(item))
          .filter((item): item is RecordFilterNode => Boolean(item));
        if (!items.length) return null;
        return { conjunction: node.conjunction, items };
      }

      const operator = node.operator as RecordFilterOperator;
      const operatorsExpectingNull: ReadonlySet<RecordFilterOperator> = new Set([
        'isEmpty',
        'isNotEmpty',
      ]);
      const operatorsExpectingArray: ReadonlySet<RecordFilterOperator> = new Set([
        'isAnyOf',
        'isNoneOf',
        'hasAnyOf',
        'hasAllOf',
        'isNotExactly',
        'hasNoneOf',
        'isExactly',
      ]);
      const fieldMeta = fieldMetaMap.get(node.fieldId);
      let value = node.value as RecordFilterValue;

      if (operatorsExpectingNull.has(operator)) {
        if (value !== null) return null;
        return { ...node, value: null };
      }

      if (value == null) {
        const isCheckboxField =
          fieldMeta?.type === FieldType.Checkbox ||
          fieldMeta?.cellValueType === CellValueType.Boolean;
        if (isCheckboxField) {
          if (operator === 'is') {
            value = false;
          } else if (operator === 'isNot') {
            value = true;
          } else {
            return null;
          }
        } else {
          // For non-checkbox fields, is/isNot with null means isEmpty/isNotEmpty
          if (operator === 'is') {
            return { fieldId: node.fieldId, operator: 'isEmpty', value: null };
          }
          if (operator === 'isNot') {
            return { fieldId: node.fieldId, operator: 'isNotEmpty', value: null };
          }
          return null;
        }
      }

      if (
        currentUserId &&
        fieldMeta &&
        [FieldType.User, FieldType.CreatedBy, FieldType.LastModifiedBy].includes(
          fieldMeta.type as FieldType
        )
      ) {
        if (Array.isArray(value)) {
          value = value.map((entry) =>
            typeof entry === 'string' && isMeTag(entry) ? currentUserId : entry
          ) as RecordFilterValue;
        } else if (typeof value === 'string' && isMeTag(value)) {
          value = currentUserId as RecordFilterValue;
        }
      }

      if (operatorsExpectingArray.has(operator)) {
        if (!Array.isArray(value) && !this.isRecordFilterFieldReferenceValue(value)) {
          value = [value] as RecordFilterValue;
        }
        if (Array.isArray(value) && value.length === 0) return null;
      }

      return {
        ...node,
        value,
      };
    };

    const normalized = normalizeNode(mapped);
    return normalized ?? undefined;
  }

  private mapV1FilterToV2(filter: unknown): RecordFilter | undefined | null {
    if (filter === undefined) return undefined;
    if (filter === null) return null;
    if (this.isV2FilterNode(filter)) return this.normalizeV2FilterNode(filter);
    if (this.isV1FilterGroup(filter)) return this.mapV1FilterGroup(filter);
    if (this.isV1FilterItem(filter)) return this.mapV1FilterItem(filter);
    return undefined;
  }

  private isV2FilterNode(value: unknown): value is RecordFilterNode {
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.items)) return true;
    if (record.not && typeof record.not === 'object') return true;
    if (typeof record.fieldId === 'string' && typeof record.operator === 'string') return true;
    return false;
  }

  private isV1FilterGroup(
    value: unknown
  ): value is { conjunction: 'and' | 'or'; filterSet: unknown[] } {
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    return Array.isArray(record.filterSet);
  }

  private isV1FilterItem(
    value: unknown
  ): value is { fieldId: string; operator: string; value?: unknown; isSymbol?: boolean } {
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    return typeof record.fieldId === 'string' && typeof record.operator === 'string';
  }

  private mapV1FilterGroup(filter: {
    conjunction: 'and' | 'or';
    filterSet: unknown[];
  }): RecordFilterGroup | null {
    const items = filter.filterSet
      .map((entry) => this.mapV1FilterEntry(entry))
      .filter((entry): entry is RecordFilterNode => Boolean(entry));
    if (items.length === 0) return null;
    return {
      conjunction: filter.conjunction === 'or' ? 'or' : 'and',
      items,
    };
  }

  private mapV1FilterEntry(entry: unknown): RecordFilterNode | null {
    if (entry === null || entry === undefined) return null;
    if (this.isV1FilterGroup(entry)) return this.mapV1FilterGroup(entry);
    if (this.isV1FilterItem(entry)) return this.mapV1FilterItem(entry);
    if (this.isV2FilterNode(entry)) return this.normalizeV2FilterNode(entry);
    return null;
  }

  private mapV1FilterItem(filter: {
    fieldId: string;
    operator: string;
    value?: unknown;
    isSymbol?: boolean;
  }): RecordFilterNode | null {
    const operator = this.normalizeV1Operator(
      filter.operator,
      filter.isSymbol
    ) as RecordFilterOperator;
    const rawValue = 'value' in filter ? filter.value : null;
    const legacyDateRangeCondition = this.mapLegacyDateRangeCondition(
      filter.fieldId,
      operator,
      rawValue
    );
    if (legacyDateRangeCondition) return legacyDateRangeCondition;

    const operatorsExpectingNull: ReadonlySet<RecordFilterOperator> = new Set([
      'isEmpty',
      'isNotEmpty',
    ]);
    const operatorsExpectingArray: ReadonlySet<RecordFilterOperator> = new Set([
      'isAnyOf',
      'isNoneOf',
      'hasAnyOf',
      'hasAllOf',
      'isNotExactly',
      'hasNoneOf',
      'isExactly',
    ]);

    if (operatorsExpectingNull.has(operator)) {
      return {
        fieldId: filter.fieldId,
        operator,
        value: null,
      };
    }

    if (operatorsExpectingArray.has(operator)) {
      let value = rawValue;
      if (value == null) return null;
      if (!Array.isArray(value) && !this.isRecordFilterFieldReferenceValue(value)) {
        value = [value];
      }
      if (Array.isArray(value) && value.length === 0) return null;
      return {
        fieldId: filter.fieldId,
        operator,
        value: value as RecordFilterValue,
      };
    }

    if (rawValue == null) {
      // V1 uses {operator: "is", value: null} for "field is empty"
      // and {operator: "isNot", value: null} for "field is not empty"
      // Preserve the filter as-is; v2 core handles is/isNot with null value
      if (operator === 'is' || operator === 'isNot') {
        return { fieldId: filter.fieldId, operator, value: null };
      }
      return null;
    }

    return {
      fieldId: filter.fieldId,
      operator,
      value: rawValue as RecordFilterValue,
    };
  }

  private normalizeV1Operator(operator: string, isSymbol?: boolean): string {
    const mapped = v1SymbolOperatorMap[operator];
    if (mapped) return mapped;
    if (isSymbol) return operator;
    return operator;
  }

  private mapLegacyDateRangeCondition(
    fieldId: string,
    operator: RecordFilterOperator,
    value: unknown
  ): RecordFilterNode | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

    const record = value as Record<string, unknown>;
    if (record.mode !== 'dateRange') return null;

    if (operator !== 'is' && operator !== 'isWithIn') {
      this.throwV2Error(
        {
          code: invalidFilterCode,
          message: 'dateRange mode only supports is/isWithIn operators',
          tags: ['validation'],
        },
        HttpStatus.BAD_REQUEST
      );
    }

    const exactDate = record.exactDate;
    const exactDateEnd = record.exactDateEnd;
    const timeZone = record.timeZone;
    if (
      typeof exactDate !== 'string' ||
      typeof exactDateEnd !== 'string' ||
      typeof timeZone !== 'string'
    ) {
      return null;
    }

    const startTimestamp = Date.parse(exactDate);
    const endTimestamp = Date.parse(exactDateEnd);
    if (!Number.isFinite(startTimestamp) || !Number.isFinite(endTimestamp)) {
      return null;
    }
    if (startTimestamp > endTimestamp) {
      this.throwV2Error(
        {
          code: invalidFilterCode,
          message: 'dateRange exactDate must be less than or equal to exactDateEnd',
          tags: ['validation'],
          details: { fieldId, exactDate, exactDateEnd },
        },
        HttpStatus.BAD_REQUEST
      );
    }

    return {
      conjunction: 'and',
      items: [
        {
          fieldId,
          operator: 'isOnOrAfter',
          value: {
            mode: 'exactDate',
            exactDate,
            timeZone,
          } as RecordFilterDateValue,
        },
        {
          fieldId,
          operator: 'isOnOrBefore',
          value: {
            mode: 'exactDate',
            exactDate: exactDateEnd,
            timeZone,
          } as RecordFilterDateValue,
        },
      ],
    };
  }

  private normalizeV2FilterNode(filter: RecordFilterNode): RecordFilterNode | null {
    if ('not' in filter) {
      const next = this.normalizeV2FilterNode(filter.not);
      if (!next) return null;
      return { not: next };
    }

    if ('items' in filter) {
      const items = filter.items
        .map((item) => this.normalizeV2FilterNode(item))
        .filter((item): item is RecordFilterNode => Boolean(item));
      if (!items.length) return null;
      return { conjunction: filter.conjunction, items };
    }

    const operator = filter.operator as RecordFilterOperator;
    const value = filter.value as RecordFilterValue;
    const legacyDateRangeCondition = this.mapLegacyDateRangeCondition(
      filter.fieldId,
      operator,
      value
    );
    if (legacyDateRangeCondition) return legacyDateRangeCondition;

    const operatorsExpectingNull: ReadonlySet<RecordFilterOperator> = new Set([
      'isEmpty',
      'isNotEmpty',
    ]);
    const operatorsExpectingArray: ReadonlySet<RecordFilterOperator> = new Set([
      'isAnyOf',
      'isNoneOf',
      'hasAnyOf',
      'hasAllOf',
      'isNotExactly',
      'hasNoneOf',
      'isExactly',
    ]);

    if (operatorsExpectingNull.has(operator)) {
      if (value !== null) return null;
      return filter;
    }

    if (operatorsExpectingArray.has(operator)) {
      if (value == null) return null;
      if (Array.isArray(value) && value.length === 0) return null;
      return filter;
    }

    if (value == null) {
      if (operator === 'is' || operator === 'isNot') {
        return { fieldId: filter.fieldId, operator, value: null };
      }
      return null;
    }
    return filter;
  }

  private isRecordFilterFieldReferenceValue(value: unknown): value is {
    fieldId: string;
    type: 'field';
  } {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    return record.type === 'field' && typeof record.fieldId === 'string';
  }

  async duplicateRecord(
    tableId: string,
    recordId: string,
    order?: IRecordInsertOrderRo
  ): Promise<IRecord> {
    const container = await this.v2ContainerService.getContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext();

    const result = await executeDuplicateRecordEndpoint(
      context,
      {
        tableId,
        recordId,
        order,
      },
      commandBus
    );

    if (result.status === 201 && result.body.ok) {
      await this.clearUndoRedoEnginePreference(tableId);

      const duplicatedRecordId = result.body.data.record.id;

      // Use V1 to get the full record with proper field key mapping
      const snapshots = await this.recordService.getSnapshotBulkWithPermission(
        tableId,
        [duplicatedRecordId],
        undefined,
        FieldKeyType.Name,
        undefined,
        true
      );

      if (snapshots.length !== 1 || !snapshots[0]) {
        throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
      }

      return snapshots[0].data as IRecord;
    }

    if (!result.body.ok) {
      this.throwV2Error(result.body.error, result.status);
    }

    throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
  }
}
