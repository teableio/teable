/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable sonarjs/cognitive-complexity */
import { Injectable, HttpException, HttpStatus, Optional } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import {
  CellFormat,
  CellValueType,
  FieldKeyType,
  FieldType,
  HttpErrorCode,
  SortFunc,
  TimeFormatting,
  formatDateToString,
  getDbFieldType,
  isMeTag,
  parseClipboardText,
  stringifyClipboardText,
  type IAttachmentItem,
  type IDatetimeFormatting,
  type IFieldVo,
  type IFilter,
  type IFilterSet,
  type ISnapshotBase,
} from '@teable/core';
import type {
  IButtonClickVo,
  IClearSelectionStreamEvent,
  ICopyVo,
  IDeleteSelectionStreamEvent,
  IDuplicateSelectionStreamEvent,
  IPasteSelectionStreamEvent,
  IUpdateRecordRo,
  IFormSubmitRo,
  IRecord,
  ICreateRecordsVo,
  IGetRecordsRo,
  ICreateRecordsRo,
  IUpdateRecordsRo,
  IPasteRo,
  IPasteByIdStreamRo,
  IPasteVo,
  IRangesRo,
  IRecordGetCollaboratorsRo,
  IRecordGetCollaboratorsVo,
  IRecordStatusVo,
  ISelectionIdMutationBaseRo,
  ISelectionIdsRo,
  IRecordsVo,
  IRecordInsertOrderRo,
  IGroupHeaderRef,
  IGroupPoint,
} from '@teable/openapi';
import { GroupPointType, RangeType } from '@teable/openapi';
import {
  mapDomainErrorToHttpError,
  mapDomainErrorToHttpStatus,
  mapFieldToDto,
} from '@teable/v2-contract-http';
import {
  executeArchiveRecordsEndpoint,
  executeCreateRecordsEndpoint,
  executeSubmitRecordEndpoint,
  executeDeleteRecordsEndpoint,
  executePasteEndpoint,
  executeClearEndpoint,
  executeUpdateRecordEndpoint,
  executeUpdateRecordsEndpoint,
  executeDuplicateRecordEndpoint,
  executeListTableRecordsEndpoint,
} from '@teable/v2-contract-http-implementation/handlers';
import {
  ClearStreamCommand,
  ClickButtonCommand,
  buildUserAvatarUrl,
  DeleteByRangeStreamCommand,
  DuplicateRecordsStreamCommand,
  FieldClipboardValueVisitor,
  FieldOptionsDtoVisitor,
  FieldType as V2FieldType,
  FieldValueTypeVisitor,
  CountTableRecordsQuery,
  type CountTableRecordsResult,
  isForbiddenError,
  GetRecordCollaboratorsQuery,
  type GetRecordCollaboratorsResult,
  GetRecordStatusQuery,
  type GetRecordStatusResult,
  ListTableRecordsQuery,
  PasteStreamCommand,
  ResetButtonCommand,
  presignAttachmentFieldMaps,
  RecordQueryOperationKind,
  TableByIdSpec,
  TableId,
  v2CoreTokens,
  type ClearStreamResult,
  type ClickButtonResult,
  type DeleteByRangeStreamResult,
  type DuplicateRecordsStreamResult,
  type IArchiveRecordsCommandOptions,
  type IAttachmentUrlSignerService,
  type ICommandBus,
  type IExecutionContext,
  type IListTableRecordsQueryInput,
  type IPasteCommandInput,
  type IQueryBus,
  type IRecordReadQuerySource,
  type IRecordSearchAccessPath,
  type ITableRepository,
  type ITableRecordGroup,
  type IUserLookupService,
  type ConditionalLookupField,
  type Field as V2Field,
  type LastModifiedByField,
  type ListTableRecordsResult,
  type LookupField,
  type PasteStreamResult,
  type ResetButtonResult,
  type RecordCreateSource,
  type RecordFilter,
  type RecordFilterDateValue,
  type RecordFilterGroup,
  type RecordFilterNode,
  type RecordFilterOperator,
  type RecordFilterValue,
  type RecordQueryPluginRunner,
  type RecordQueryPluginScope,
  type RecordWritePluginRunnerOptions,
  type Table,
  type TableRecordReadModel,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { pick } from 'lodash';
import { ClsService } from 'nestjs-cls';
import { CacheService } from '../../../cache/cache.service';
import type { ICacheStore } from '../../../cache/types';
import { IThresholdConfig, ThresholdConfig } from '../../../configs/threshold.config';
import { CustomHttpException } from '../../../custom.exception';
import { DataDbClientManager } from '../../../global/data-db-client-manager.service';
import type { IClsStore } from '../../../types/cls';
import { convertValueToStringify, string2Hash } from '../../../utils';
import { generateFilterItem } from '../../../utils/filter';
import { AttachmentsService } from '../../attachments/attachments.service';
import { AuditScope } from '../../audit/audit-scope';
import type { IFieldInstance } from '../../field/model/factory';
import { createFieldInstanceByVo } from '../../field/model/factory';
import { SpaceDataDbMigrationGuardService } from '../../space/space-data-db-migration-guard.service';
import { buildUndoRedoEnginePreferenceKey } from '../../undo-redo/open-api/undo-redo-engine-preference';
import { TableQuerySearchVectorRuntimeService } from '../../v2/table-query-search-vector-runtime.service';
import { V2ContainerService } from '../../v2/v2-container.service';
import { V2ExecutionContextFactory } from '../../v2/v2-execution-context.factory';
import { throwV2Error } from '../../v2/v2-http-error';
import { convertLinkPasteCellValue } from '../paste-link-cell-value';

const internalServerError = 'Internal server error';
const invalidFilterCode = 'validation.invalid_filter';
const publicUserFieldTypes: ReadonlySet<string> = new Set(['user', 'createdBy', 'lastModifiedBy']);

interface IRecordsWithVersions {
  result: IRecordsVo;
  versionByRecordId: ReadonlyMap<string, number>;
  appliedGroupBy: IGetRecordsRo['groupBy'];
}

interface IIdRecordResponsePlan {
  checkboxFieldIds: ReadonlySet<string>;
  auditFallbacks: ReadonlyArray<{
    fieldId: string;
    source: 'createdBy' | 'lastModifiedBy';
  }>;
}

const dataTxClientKey = 'dataTx.client';
const maxResolveSelectionRecordIdsPageSize = 1000;
// Ids-only sweeps read one 20-char id per row, so the public page cap (which
// bounds response payload weight) would only buy extra round trips — each with
// its own column-existence probe. 30k rows: 31 pages -> 3.
const resolveSelectionRecordIdsIdsOnlyPageSize = 10_000;
const defaultMaxGroupPoints = 5_000;
const configuredMaxGroupPoints = Number.parseInt(
  process.env.MAX_GROUP_POINTS ?? String(defaultMaxGroupPoints),
  10
);
const maxGroupPoints =
  Number.isSafeInteger(configuredMaxGroupPoints) && configuredMaxGroupPoints > 0
    ? configuredMaxGroupPoints
    : defaultMaxGroupPoints;
const describeTraceError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
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
const dateComparisonOperators: ReadonlySet<RecordFilterOperator> = new Set([
  'is',
  'isNot',
  'isBefore',
  'isAfter',
  'isOnOrBefore',
  'isOnOrAfter',
]);
const dateFilterFieldTypes: ReadonlySet<FieldType> = new Set([
  FieldType.Date,
  FieldType.CreatedTime,
  FieldType.LastModifiedTime,
]);

type FilterFieldMeta = Pick<IFieldInstance, 'type' | 'cellValueType'> & {
  /** Optional — pure-V2 table aggregate may not materialize full V1 options. */
  options?: IFieldInstance['options'];
};

@Injectable()
export class RecordOpenApiV2Service {
  constructor(
    private readonly v2ContainerService: V2ContainerService,
    private readonly v2ContextFactory: V2ExecutionContextFactory,
    private readonly cls: ClsService<IClsStore>,
    private readonly cacheService: CacheService<ICacheStore>,
    private readonly dataDbClientManager: DataDbClientManager,
    private readonly audit: AuditScope,
    private readonly spaceDataDbMigrationGuard: SpaceDataDbMigrationGuardService,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig,
    @Optional() private readonly attachmentsService?: AttachmentsService,
    @Optional()
    private readonly tableQuerySearchVectorRuntimeService?: TableQuerySearchVectorRuntimeService
  ) {}

  private async assertTableRecordWritable(tableId: string): Promise<void> {
    await this.spaceDataDbMigrationGuard.assertTableRecordWritable(tableId);
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

  private async clearUndoRedoEnginePreference(tableId: string): Promise<void> {
    const key = this.getUndoRedoEnginePreferenceKey(tableId);
    if (!key) {
      return;
    }

    await this.cacheService.del(key);
  }

  private wrapStreamAndClearPreference<T extends { id: string }>(
    stream: AsyncIterable<T>,
    tableId: string
  ): AsyncIterable<T> {
    const clearUndoRedoEnginePreference = this.clearUndoRedoEnginePreference.bind(this);
    return {
      async *[Symbol.asyncIterator]() {
        for await (const event of stream) {
          if (event.id === 'done') {
            await clearUndoRedoEnginePreference(tableId).catch(() => undefined);
          }
          yield event;
        }
      },
    };
  }

  async getRecords(tableId: string, query: IGetRecordsRo): Promise<IRecordsVo> {
    this.assertValidListQuery(query);

    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const context = await this.v2ContextFactory.createContext(container);
    const table = await this.loadV2Table(context, container, tableId);
    const queryScope = await this.prepareRecordQueryScope(context, container, table, {
      kind: RecordQueryOperationKind.list,
      viewId: query.viewId,
      ignoreViewQuery: query.ignoreViewQuery,
      limit: query.take,
      offset: query.skip,
      // Match legacy CTE keepPrimaryKey: skip row filter for link-selected reads.
      keepPrimaryKey: Boolean(query.filterLinkCellSelected),
    });

    const result = await this.getRecordsWithPreparedScope(
      tableId,
      query,
      queryScope,
      container,
      context,
      table
    );
    return result.result;
  }

  private assertValidListQuery(query: IGetRecordsRo): void {
    if (query.filterLinkCellSelected && query.filterLinkCellCandidate) {
      throwV2Error(
        {
          code: invalidFilterCode,
          message:
            'filterLinkCellSelected and filterLinkCellCandidate can not be set at the same time',
          tags: ['validation'],
        },
        HttpStatus.BAD_REQUEST
      );
    }
  }

  /**
   * List implementation that reuses a pre-built plugin scope (list / getOne / getByIds).
   */
  private async getRecordsWithPreparedScope(
    tableId: string,
    query: IGetRecordsRo,
    queryScope: RecordQueryPluginScope | undefined,
    container: DependencyContainer,
    context: IExecutionContext,
    table: Table,
    options?: {
      projectionFieldIds?: ReadonlyArray<string>;
      /** Id-resolution reads: select only record ids, skip extras. */
      idsOnly?: boolean;
      /** Host-only page size for ids-only sweeps (overrides the request take). */
      idsOnlyPageSize?: number;
      /** Host-only search-index semantics for ShareDB doc-id reads. */
      searchIndexMode?: 'matched' | 'view';
      /** Preserve v1 doc-id semantics for explicit statically unreadable search fields. */
      requireReadableSearchFields?: boolean;
    }
  ): Promise<IRecordsWithVersions> {
    // undefined = unrestricted; empty array = no user fields (deny-all fields).
    const enabledFieldIds =
      queryScope?.readableFieldIds != null ? [...queryScope.readableFieldIds] : undefined;
    // Clients often send groupBy/orderBy field *names*; list uses field ids.
    // Resolve before dispatch; the V2 handler owns permission validation so
    // explicit unreadable sort/group keys cannot be silently removed here.
    const effectiveQuery = {
      ...query,
      orderBy: this.resolveSortGroupFieldKeysToIds(table, query.orderBy ?? undefined),
      groupBy: this.resolveSortGroupFieldKeysToIds(table, query.groupBy ?? undefined),
    } satisfies IGetRecordsRo;

    const requestedFieldKeyType = query.fieldKeyType ?? FieldKeyType.Name;
    // Field metadata comes only from the V2 table aggregate (DDD), never FieldService.
    const projectionFieldIds =
      options?.projectionFieldIds != null
        ? [...options.projectionFieldIds]
        : this.withRecordReadSyncSpan(
            context,
            'teable.RecordOpenApiV2Service.resolveListProjection',
            {
              'record.read.has_explicit_projection': Boolean(query.projection),
              'record.read.has_enabled_fields': enabledFieldIds != null,
              'record.read.field_key_type': requestedFieldKeyType,
            },
            () => this.resolveListProjectionFieldIdsFromTable(table, query, enabledFieldIds)
          );
    const filterWithCollapsedGroups = effectiveQuery.filter;
    const normalizedFilter = this.withRecordReadSyncSpan(
      context,
      'teable.RecordOpenApiV2Service.normalizeFilter',
      {
        'record.read.has_filter': Boolean(filterWithCollapsedGroups),
      },
      () => this.normalizeFilterForV2FromTable(table, filterWithCollapsedGroups)
    );
    const sortWithGroupFallback = this.mergeGroupByIntoSort(
      effectiveQuery.groupBy,
      effectiveQuery.orderBy
    );
    const normalizedSort = sortWithGroupFallback?.map((item) => ({
      fieldId: item.fieldId,
      order: item.order,
    }));
    const normalizedGroupBy = effectiveQuery.groupBy?.map((item) => item.fieldId);
    const recordSearchAccessPath = await this.resolveRecordSearchAccessPath(
      context,
      tableId,
      container,
      effectiveQuery.search
    );
    const shouldExposeGroupMetadata =
      this.shouldLoadQueryExtra(effectiveQuery, recordSearchAccessPath) &&
      Boolean(effectiveQuery.groupBy?.length);
    const shouldComputeGroupMetadata =
      Boolean(effectiveQuery.groupBy?.length) &&
      (shouldExposeGroupMetadata || Boolean(effectiveQuery.collapsedGroupIds?.length));
    // Grid search highlight (extra.searchHitIndex) comes from the V2 list
    // query itself: includeSearchFieldMatches adds per-field match columns to
    // the same page SELECT, so no V1 pipeline and no extra round trip run.
    // Request matches for a grouped search too: the core handler may remove
    // every view-owned group under field permissions, making the response an
    // ungrouped page. We expose the matches only after seeing appliedGroup.
    const shouldRequestSearchHitIndex =
      !options?.idsOnly &&
      this.shouldLoadQueryExtra(
        { ...effectiveQuery, groupBy: undefined, collapsedGroupIds: undefined },
        recordSearchAccessPath
      );
    const queryBus = container.resolve<IQueryBus>(v2CoreTokens.queryBus);
    const listInput = {
      tableId,
      // List always uses field ids internally; response keys remapped below.
      fieldKeyType: 'id' as const,
      limit: query.take,
      offset: query.skip,
      projection: projectionFieldIds,
      includeTotal: shouldComputeGroupMetadata,
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
    } satisfies IListTableRecordsQueryInput;
    let listResult = await this.withRecordReadSpan(
      context,
      'teable.RecordOpenApiV2Service.listRecords',
      {
        'record.read.limit': query.take ?? 0,
        'record.read.offset': query.skip ?? 0,
        'record.read.has_filter': Boolean(normalizedFilter),
        'record.read.sort_count': normalizedSort?.length ?? 0,
        'record.read.group_by_count': normalizedGroupBy?.length ?? 0,
        'record.read.projection_count': projectionFieldIds.length,
        'record.read.has_query_scope': Boolean(queryScope),
        'record.read.include_search_matches': shouldRequestSearchHitIndex,
      },
      () =>
        this.executeListTableRecordsQuery(listInput, context, queryBus, {
          queryScope,
          ...(recordSearchAccessPath ? { recordSearchAccessPath } : {}),
          includeGroupMetadata: shouldComputeGroupMetadata,
          ...(shouldComputeGroupMetadata ? { groupLimit: maxGroupPoints } : {}),
          ...(options?.idsOnly
            ? {
                idsOnly: true,
                ...(options.idsOnlyPageSize ? { idsOnlyPageSize: options.idsOnlyPageSize } : {}),
              }
            : {}),
          ...(shouldRequestSearchHitIndex
            ? {
                includeSearchFieldMatches: true,
                searchFieldScope: 'visible' as const,
                ...(options?.searchIndexMode ? { searchIndexMode: options.searchIndexMode } : {}),
                ...(options?.requireReadableSearchFields
                  ? { requireReadableSearchFields: true }
                  : {}),
              }
            : {}),
          table,
        })
    );

    // The core handler can strip unreadable or conditionally masked view-owned
    // group levels. Build presentation metadata from the applied group so the
    // API does not synthesize an Unknown group or misalign remaining depths.
    // The groups fallback keeps compatibility with tests/custom query buses
    // that return repository groups without the newer appliedGroup metadata.
    const appliedGroupBy: IGetRecordsRo['groupBy'] = listResult.appliedGroup
      ? listResult.appliedGroup.map((item) => ({
          ...item,
          order: item.order === 'asc' ? SortFunc.Asc : SortFunc.Desc,
        }))
      : listResult.groups !== undefined
        ? effectiveQuery.groupBy
        : undefined;
    const shouldLoadSearchHitIndex = shouldRequestSearchHitIndex && !appliedGroupBy?.length;
    const searchHitIndexExtra = this.withRecordReadSyncSpan(
      context,
      'teable.RecordOpenApiV2Service.queryExtra',
      {
        'record.read.query_extra_enabled': shouldLoadSearchHitIndex,
        'record.read.include_query_extra': query.includeQueryExtra !== false,
        'record.read.has_search': Boolean(effectiveQuery.search),
        'record.read.search_access_path': recordSearchAccessPath?.kind ?? 'default',
        'record.read.query_extra_match_count': listResult.searchMatches?.length ?? 0,
      },
      () =>
        this.buildSearchHitIndexExtra(
          shouldLoadSearchHitIndex,
          listResult.searchMatches,
          projectionFieldIds
        )
    );
    let computedGroupExtra = shouldComputeGroupMetadata
      ? this.buildGroupQueryExtra(
          table,
          appliedGroupBy,
          listResult.groups,
          listResult.total,
          effectiveQuery.collapsedGroupIds
        )
      : undefined;
    computedGroupExtra = await this.hydrateLegacyUserGroupExtra(
      container,
      table,
      appliedGroupBy,
      computedGroupExtra
    );
    let queryExtra = this.mergeQueryExtra(
      shouldExposeGroupMetadata ? computedGroupExtra : undefined,
      searchHitIndexExtra
    );
    queryExtra = await this.presignAttachmentGroupExtra(
      container,
      table,
      appliedGroupBy,
      queryExtra
    );
    const collapsedFilter = this.buildCollapsedGroupFilter(
      table,
      appliedGroupBy,
      computedGroupExtra?.groupPoints,
      effectiveQuery.collapsedGroupIds
    );
    if (collapsedFilter) {
      const filteredResult = await this.executeListTableRecordsQuery(
        {
          ...listInput,
          filter: normalizedFilter
            ? { conjunction: 'and', items: [normalizedFilter, collapsedFilter] }
            : collapsedFilter,
          includeTotal: false,
        },
        context,
        queryBus,
        {
          queryScope,
          ...(recordSearchAccessPath ? { recordSearchAccessPath } : {}),
          includeGroupMetadata: false,
          table,
        }
      );
      listResult = {
        ...filteredResult,
        total: listResult.total,
        groups: listResult.groups,
      };
    }

    if (listResult.records.length === 0) {
      return {
        result: queryExtra ? { records: [], extra: queryExtra } : { records: [] },
        versionByRecordId: new Map(),
        appliedGroupBy,
      };
    }
    const versionByRecordId = new Map(
      listResult.records.map((record) => [record.id, record.version] as const)
    );

    const primaryFieldId = table.primaryFieldId().toString();
    const primaryField = table.getField((field) => field.id().toString() === primaryFieldId);
    const primaryFormatter = primaryField.isOk()
      ? this.createDisplayFieldInstance(primaryField.value)
      : undefined;
    let records = this.withRecordReadSyncSpan(
      context,
      'teable.RecordOpenApiV2Service.mapReadModels',
      {
        'record.read.record_count': listResult.records.length,
        'record.read.field_key_type': requestedFieldKeyType,
      },
      () => {
        const idResponsePlan = this.isIdFieldKeyType(requestedFieldKeyType)
          ? this.createIdRecordResponsePlan(table)
          : undefined;
        return listResult.records.map((record) =>
          this.mapTableRecordReadModelToIRecord(
            table,
            record,
            primaryFieldId,
            requestedFieldKeyType,
            idResponsePlan,
            primaryFormatter
          )
        );
      }
    );
    records = await this.hydrateLegacyUserCells(container, table, records, requestedFieldKeyType);

    let normalizedRecords = this.withRecordReadSyncSpan(
      context,
      'teable.RecordOpenApiV2Service.formatRecords',
      {
        'record.read.record_count': records.length,
        'record.read.sorted_field_count': sortWithGroupFallback?.length ?? 0,
        'record.read.cell_format': query.cellFormat ?? CellFormat.Json,
      },
      () =>
        this.formatSystemDatetimeFieldsFromTable(
          table,
          records,
          query.cellFormat,
          sortWithGroupFallback?.map((item) => item.fieldId)
        )
    );

    // Pure-V2 presentation: no FieldService / RecordService. Attachment URLs
    // via IAttachmentUrlSignerService + free-function presign helpers.
    if (query.cellFormat === CellFormat.Text) {
      normalizedRecords = this.formatRecordFieldsAsDisplayText(
        table,
        normalizedRecords,
        requestedFieldKeyType
      );
    } else {
      normalizedRecords = await this.presignAttachmentFieldsFromTable(
        container,
        table,
        normalizedRecords,
        requestedFieldKeyType
      );
    }

    return {
      result: queryExtra
        ? { records: normalizedRecords, extra: queryExtra }
        : { records: normalizedRecords },
      versionByRecordId,
      appliedGroupBy,
    };
  }

  private mergeQueryExtra(
    groupExtra: IRecordsVo['extra'] | undefined,
    otherExtra: IRecordsVo['extra'] | undefined
  ): IRecordsVo['extra'] | undefined {
    if (!groupExtra && !otherExtra) return undefined;
    return {
      ...(otherExtra?.searchHitIndex !== undefined
        ? { searchHitIndex: otherExtra.searchHitIndex }
        : groupExtra
          ? { searchHitIndex: null }
          : {}),
      ...(groupExtra?.groupPoints !== undefined ? { groupPoints: groupExtra.groupPoints } : {}),
      ...(groupExtra?.allGroupHeaderRefs !== undefined
        ? { allGroupHeaderRefs: groupExtra.allGroupHeaderRefs }
        : {}),
    };
  }

  private buildGroupQueryExtra(
    table: Table,
    groupBy: IGetRecordsRo['groupBy'],
    groups: ReadonlyArray<ITableRecordGroup> | undefined,
    rowCount: number,
    collapsedGroupIds?: ReadonlyArray<string>
  ): IRecordsVo['extra'] | undefined {
    if (!groupBy?.length) return undefined;

    const collapsed = new Set(collapsedGroupIds ?? []);
    const groupPoints: IGroupPoint[] = [];
    const allGroupHeaderRefs: IGroupHeaderRef[] = [];
    let previousValues: unknown[] = [];
    let collapsedDepth = Number.MAX_SAFE_INTEGER;
    let groupedRowCount = 0;

    for (const group of groups ?? []) {
      for (let depth = 0; depth < groupBy.length; depth += 1) {
        const fieldId = groupBy[depth]!.fieldId;
        const value = group.fields[fieldId] ?? null;
        const outputValue = this.normalizeGroupPointValue(table, fieldId, value);
        const comparable = convertValueToStringify(
          this.groupPointIdentityValue(table, fieldId, value, outputValue)
        );
        if (previousValues[depth] === comparable) continue;

        const groupId = String(
          string2Hash(`${fieldId}_${[...previousValues.slice(0, depth), comparable].join('_')}`)
        );
        allGroupHeaderRefs.push({ id: groupId, depth });
        if (depth > collapsedDepth) break;

        collapsedDepth = Number.MAX_SAFE_INTEGER;
        previousValues[depth] = comparable;
        previousValues = previousValues.slice(0, depth + 1);
        const isCollapsed = collapsed.has(groupId);
        groupPoints.push({
          id: groupId,
          type: GroupPointType.Header,
          depth,
          value: outputValue,
          isCollapsed,
        });
        if (isCollapsed) collapsedDepth = depth;
      }

      groupedRowCount += group.count;
      if (collapsedDepth !== Number.MAX_SAFE_INTEGER) continue;
      // A repository bucket keyed finer than the presentation identity (e.g. a
      // lookup of user snapshots) arrives as a consecutive group with no new
      // header, leaving the previous point a Row: fold it into that row block
      // instead of emitting a headerless row segment, which the grid would
      // render as an extra append-row with restarted row numbers
      const previousPoint = groupPoints[groupPoints.length - 1];
      if (previousPoint?.type === GroupPointType.Row) {
        previousPoint.count += group.count;
        continue;
      }
      groupPoints.push({ type: GroupPointType.Row, count: group.count });
    }

    if (groupedRowCount < rowCount) {
      groupPoints.push(
        {
          id: 'unknown',
          type: GroupPointType.Header,
          depth: 0,
          value: 'Unknown',
          isCollapsed: false,
        },
        { type: GroupPointType.Row, count: rowCount - groupedRowCount }
      );
    }

    return { groupPoints, allGroupHeaderRefs };
  }

  private normalizeGroupPointValue(table: Table, fieldId: string, value: unknown): unknown {
    if (value instanceof Date) return value.toISOString();
    const field = table.getField((candidate) => candidate.id().toString() === fieldId);
    if (field.isErr()) {
      return value;
    }
    if (this.presentationFieldType(field.value) === V2FieldType.checkbox().toString()) {
      return value ?? null;
    }
    if (this.isPublicUserValueField(field.value)) {
      return this.normalizeGroupUserValue(value);
    }
    return value;
  }

  private groupPointIdentityValue(
    table: Table,
    fieldId: string,
    storedValue: unknown,
    outputValue: unknown
  ): unknown {
    const field = table.getField((candidate) => candidate.id().toString() === fieldId);
    if (field.isErr() || !this.isPublicUserValueField(field.value)) {
      return storedValue;
    }
    return this.userGroupIdentityValue(outputValue);
  }

  private userGroupIdentityValue(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.userGroupIdentityValue(item));
    }
    if (!value || typeof value !== 'object') {
      return value;
    }
    const user = value as Record<string, unknown>;
    return {
      id: user.id,
      title: user.title,
    };
  }

  private normalizeGroupUserValue(
    value: unknown,
    resolvedUsers: ReadonlyMap<string, { id: string; title: string; email?: string }> = new Map()
  ): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.normalizeGroupUserValue(item, resolvedUsers));
    }
    const normalized = this.normalizePublicUserValue(value, resolvedUsers);
    if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
      return normalized;
    }
    const groupValue = { ...(normalized as Record<string, unknown>) };
    delete groupValue.email;
    return groupValue;
  }

  private async hydrateLegacyUserGroupExtra(
    container: DependencyContainer,
    table: Table,
    groupBy: IGetRecordsRo['groupBy'],
    extra: IRecordsVo['extra'] | undefined
  ): Promise<IRecordsVo['extra'] | undefined> {
    if (!extra?.groupPoints?.length || !groupBy?.length) {
      return extra;
    }

    const userGroupDepths = new Set(
      groupBy.flatMap((item, depth) => {
        const field = table.getField((candidate) => candidate.id().toString() === item.fieldId);
        return field.isOk() && this.isPublicUserValueField(field.value) ? [depth] : [];
      })
    );
    if (!userGroupDepths.size) {
      return extra;
    }

    const userIds = new Set<string>();
    for (const point of extra.groupPoints) {
      if (
        point.type === GroupPointType.Header &&
        point.id !== 'unknown' &&
        userGroupDepths.has(point.depth)
      ) {
        this.collectGroupUserIds(point.value, userIds);
      }
    }
    if (!userIds.size) {
      return extra;
    }

    const resolvedUsers = await this.resolvePublicUsers(container, userIds);
    return {
      ...extra,
      groupPoints: extra.groupPoints.map((point) =>
        point.type === GroupPointType.Header &&
        point.id !== 'unknown' &&
        userGroupDepths.has(point.depth)
          ? { ...point, value: this.normalizeGroupUserValue(point.value, resolvedUsers) }
          : point
      ),
    };
  }

  private async presignAttachmentGroupExtra(
    container: DependencyContainer,
    table: Table,
    groupBy: IGetRecordsRo['groupBy'],
    extra: IRecordsVo['extra'] | undefined
  ): Promise<IRecordsVo['extra'] | undefined> {
    if (
      !extra?.groupPoints?.length ||
      !groupBy?.length ||
      !container.isRegistered(v2CoreTokens.attachmentUrlSignerService)
    ) {
      return extra;
    }

    const attachmentFieldIds = new Set(
      table
        .getFields()
        .filter((field) => this.isAttachmentValueField(field))
        .map((field) => field.id().toString())
    );
    const headerInputs = extra.groupPoints.flatMap((point, pointIndex) => {
      if (point.type !== GroupPointType.Header || point.id === 'unknown') return [];
      const fieldId = groupBy[point.depth]?.fieldId;
      return fieldId && attachmentFieldIds.has(fieldId)
        ? [{ pointIndex, fieldId, fields: { [fieldId]: point.value } }]
        : [];
    });
    if (!headerInputs.length) return extra;

    const signer = container.resolve<IAttachmentUrlSignerService>(
      v2CoreTokens.attachmentUrlSignerService
    );
    const signedResult = await presignAttachmentFieldMaps(
      headerInputs.map((input) => input.fields),
      attachmentFieldIds,
      signer
    );
    if (signedResult.isErr()) return extra;

    const signedValueByPointIndex = new Map(
      headerInputs.map((input, index) => [
        input.pointIndex,
        signedResult.value[index]?.[input.fieldId],
      ])
    );
    return {
      ...extra,
      groupPoints: extra.groupPoints.map((point, pointIndex) =>
        signedValueByPointIndex.has(pointIndex) && point.type === GroupPointType.Header
          ? { ...point, value: signedValueByPointIndex.get(pointIndex) }
          : point
      ),
    };
  }

  private buildCollapsedGroupFilter(
    table: Table,
    groupBy: IGetRecordsRo['groupBy'],
    groupPoints: ReadonlyArray<IGroupPoint> | null | undefined,
    collapsedGroupIds?: ReadonlyArray<string>
  ): RecordFilter | undefined {
    if (!groupBy?.length || !groupPoints?.length || !collapsedGroupIds?.length) {
      return undefined;
    }

    const pathValues: unknown[] = [];
    const pathByHeaderId = new Map<string, unknown[]>();
    for (const point of groupPoints) {
      if (point.type !== GroupPointType.Header || point.id === 'unknown') continue;
      pathValues.length = point.depth;
      pathValues[point.depth] = point.value;
      pathByHeaderId.set(point.id, [...pathValues]);
    }

    // V1 parity: each collapsed group is excluded with an OR of per-depth
    // null-inclusive negations (isNot/isNotEmpty/isNotExactly, exactFormatDate
    // for dates), so rows in the empty bucket stay visible and date buckets
    // match the field's formatting granularity. Plain not+is would drop
    // NULL-valued rows (three-valued NOT).
    const filterFieldCache = new Map<string, IFieldInstance | undefined>();
    const resolveFilterField = (fieldId: string): IFieldInstance | undefined => {
      if (!filterFieldCache.has(fieldId)) {
        const field = table.getField((candidate) => candidate.id().toString() === fieldId);
        filterFieldCache.set(
          fieldId,
          field.isOk() ? this.createDisplayFieldInstance(field.value) : undefined
        );
      }
      return filterFieldCache.get(fieldId);
    };

    const exclusions: IFilterSet[] = [];
    for (const collapsedId of collapsedGroupIds) {
      const path = pathByHeaderId.get(collapsedId);
      if (!path) continue;
      const innerFilterSet: IFilterSet = { conjunction: 'or', filterSet: [] };
      for (let depth = 0; depth < path.length; depth += 1) {
        const fieldId = groupBy[depth]?.fieldId;
        if (!fieldId) continue;
        const field = resolveFilterField(fieldId);
        if (!field) continue;
        innerFilterSet.filterSet.push(generateFilterItem(field, path[depth] ?? null));
      }
      if (!innerFilterSet.filterSet.length) continue;
      exclusions.push(innerFilterSet);
    }

    if (!exclusions.length) return undefined;
    const v1Filter: IFilterSet = { conjunction: 'and', filterSet: exclusions };
    return this.normalizeFilterForV2FromTable(table, v1Filter) ?? undefined;
  }

  async getSocketDocIds(
    tableId: string,
    query: IGetRecordsRo
  ): Promise<{ ids: string[]; extra?: IRecordsVo['extra'] }> {
    this.assertValidListQuery(query);

    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const context = await this.v2ContextFactory.createContext(container);
    const table = await this.loadV2Table(context, container, tableId);
    const queryScope = await this.prepareRecordQueryScope(context, container, table, {
      kind: RecordQueryOperationKind.list,
      viewId: query.viewId,
      ignoreViewQuery: query.ignoreViewQuery,
      limit: query.take,
      offset: query.skip,
      keepPrimaryKey: Boolean(query.filterLinkCellSelected),
    });
    const { result } = await this.getRecordsWithPreparedScope(
      tableId,
      {
        ...query,
        fieldKeyType: FieldKeyType.Id,
        cellFormat: CellFormat.Json,
      },
      queryScope,
      container,
      context,
      table,
      {
        projectionFieldIds: [],
        searchIndexMode: 'matched',
        requireReadableSearchFields: true,
      }
    );
    return result.extra
      ? { ids: result.records.map((record) => record.id), extra: result.extra }
      : { ids: result.records.map((record) => record.id) };
  }

  async getOrderedReadableFieldIds(
    tableId: string,
    query: {
      viewId?: string;
      projection?: string[];
      ignoreViewQuery?: boolean;
    }
  ): Promise<string[]> {
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const context = await this.v2ContextFactory.createContext(container);
    const table = await this.loadV2Table(context, container, tableId);
    const queryScope = await this.prepareRecordQueryScope(context, container, table, {
      kind: RecordQueryOperationKind.list,
      viewId: query.viewId,
      ignoreViewQuery: query.ignoreViewQuery,
    });
    const orderedFieldIds = query.viewId
      ? table.getOrderedVisibleFieldIds(query.viewId, {
          projection: query.projection,
          includeHiddenFields: query.ignoreViewQuery === true,
        })
      : undefined;
    const orderedIds = (orderedFieldIds?.isOk() ? orderedFieldIds.value : table.fieldIds()).map(
      (fieldId) => fieldId.toString()
    );
    if (queryScope?.readableFieldIds == null) {
      return orderedIds;
    }
    return orderedIds.filter((fieldId) => queryScope.readableFieldIds!.has(fieldId));
  }

  async getSocketSnapshotBulk(
    tableId: string,
    recordIds: string[],
    projection?: { [fieldNameOrId: string]: boolean }
  ): Promise<ISnapshotBase<IRecord>[]> {
    if (recordIds.length === 0) {
      return [];
    }

    const requestedProjectionFieldIds = projection
      ? Object.entries(projection)
          .filter(([, included]) => included)
          .map(([fieldId]) => fieldId)
      : [];
    const projectionFieldIds = requestedProjectionFieldIds.length
      ? requestedProjectionFieldIds
      : undefined;
    const { recordById, versionByRecordId } = await this.loadRecordsByIds(tableId, recordIds, {
      projection: projectionFieldIds,
      fieldKeyType: FieldKeyType.Id,
      cellFormat: CellFormat.Json,
      // ShareDB query membership already scopes subscribed ids; retain known
      // documents for version continuity while still applying field scope.
      keepPrimaryKey: true,
    });

    return recordIds.flatMap((recordId) => {
      const record = recordById.get(recordId);
      const version = versionByRecordId.get(recordId);
      if (!record || version == null) {
        return [];
      }
      return [
        {
          id: recordId,
          v: version,
          type: 'json0',
          data: record,
        },
      ];
    });
  }

  async getRecordsByIds(
    tableId: string,
    recordIds: string[],
    query: {
      projection?: string[];
      cellFormat?: CellFormat;
      fieldKeyType?: FieldKeyType;
      throwOnMissing?: boolean;
    }
  ): Promise<IRecord[]> {
    if (recordIds.length === 0) {
      return [];
    }

    // Load the table and permission scope once, then page ids through one shared
    // query context. Selection operations must not fan out one table load per row.
    const { recordById } = await this.loadRecordsByIds(tableId, recordIds, {
      projection: query.projection,
      fieldKeyType: query.fieldKeyType ?? FieldKeyType.Name,
      cellFormat: query.cellFormat,
      keepPrimaryKey: false,
      throwOnMissing: query.throwOnMissing ?? false,
    });

    return recordIds.flatMap((recordId) => {
      const record = recordById.get(recordId);
      return record ? [record] : [];
    });
  }

  private async loadRecordsByIds(
    tableId: string,
    recordIds: string[],
    options: {
      projection?: string[];
      cellFormat?: CellFormat;
      fieldKeyType: FieldKeyType;
      keepPrimaryKey: boolean;
      throwOnMissing?: boolean;
    }
  ): Promise<{
    recordById: Map<string, IRecord>;
    versionByRecordId: Map<string, number>;
  }> {
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const context = await this.v2ContextFactory.createContext(container);
    const table = await this.loadV2Table(context, container, tableId);
    const queryScope = await this.prepareRecordQueryScope(context, container, table, {
      kind: RecordQueryOperationKind.getByIds,
      recordIds,
      projectionFieldIds: options.projection,
      ignoreViewQuery: true,
      keepPrimaryKey: options.keepPrimaryKey,
    });
    const recordById = new Map<string, IRecord>();
    const versionByRecordId = new Map<string, number>();
    for (let index = 0; index < recordIds.length; index += maxResolveSelectionRecordIdsPageSize) {
      const chunk = recordIds.slice(index, index + maxResolveSelectionRecordIdsPageSize);
      const query = {
        selectedRecordIds: chunk,
        take: chunk.length,
        skip: 0,
        projection: options.projection,
        fieldKeyType: options.fieldKeyType,
        cellFormat: options.cellFormat,
        ignoreViewQuery: true,
        includeQueryExtra: false,
      } satisfies IGetRecordsRo;
      const page = await this.getRecordsWithPreparedScope(
        tableId,
        query,
        queryScope,
        container,
        context,
        table
      );
      for (const record of page.result.records) {
        recordById.set(record.id, record);
      }
      for (const [recordId, version] of page.versionByRecordId) {
        versionByRecordId.set(recordId, version);
      }
    }

    if (options.throwOnMissing) {
      // Selection mutations pair clipboard rows with target records by position,
      // so a silently dropped id would shift every later row onto the wrong
      // record. Keep the per-record getRecord error semantics instead:
      // 403 when the row exists outside the discretionary row filter, else 404.
      const missingRecordId = recordIds.find((recordId) => !recordById.has(recordId));
      if (missingRecordId !== undefined) {
        const existsOutsideScope = await this.probeRecordExistsOutsideDiscretionaryRowFilter(
          tableId,
          missingRecordId,
          queryScope,
          container,
          context,
          table
        );
        if (existsOutsideScope) {
          throw new CustomHttpException(
            `Record permission not allowed: record|read`,
            HttpErrorCode.RESTRICTED_RESOURCE,
            {
              localization: {
                i18nKey: 'httpErrors.permission.notAllowedOperationRecord',
              },
            }
          );
        }
        throw new CustomHttpException('Record not found', HttpErrorCode.NOT_FOUND, {
          localization: { i18nKey: 'httpErrors.record.notFound' },
        });
      }
    }

    return { recordById, versionByRecordId };
  }

  async getRecord(
    tableId: string,
    recordId: string,
    query: {
      projection?: string[];
      cellFormat?: CellFormat;
      fieldKeyType?: FieldKeyType;
    }
  ): Promise<IRecord> {
    // Use getOne plugin kind so plugins that only support getOne (or apply a
    // stricter getOne policy) are not skipped by hard-coding list.
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const context = await this.v2ContextFactory.createContext(container);
    const table = await this.loadV2Table(context, container, tableId);
    const queryScope = await this.prepareRecordQueryScope(context, container, table, {
      kind: RecordQueryOperationKind.getOne,
      recordId,
      projectionFieldIds: query.projection,
      ignoreViewQuery: true,
    });

    const listQuery = {
      selectedRecordIds: [recordId],
      take: 1,
      skip: 0,
      projection: query.projection,
      cellFormat: query.cellFormat,
      fieldKeyType: query.fieldKeyType ?? FieldKeyType.Name,
      ignoreViewQuery: true,
    } satisfies IGetRecordsRo;

    const result = await this.getRecordsWithPreparedScope(
      tableId,
      listQuery,
      queryScope,
      container,
      context,
      table
    );
    if (result.result.records[0]) {
      return result.result.records[0];
    }

    // Authority-matrix parity: if the row exists but is outside recordSpec,
    // return 403 (not 404). EE AuthorityGuard often catches this first; this
    // covers internal/delegated paths and defense in depth.
    const existsOutsideScope = await this.probeRecordExistsOutsideDiscretionaryRowFilter(
      tableId,
      recordId,
      queryScope,
      container,
      context,
      table
    );
    if (existsOutsideScope) {
      throw new CustomHttpException(
        `Record permission not allowed: record|read`,
        HttpErrorCode.RESTRICTED_RESOURCE,
        {
          localization: {
            i18nKey: 'httpErrors.permission.notAllowedOperationRecord',
          },
        }
      );
    }

    throw new CustomHttpException('Record not found', HttpErrorCode.NOT_FOUND, {
      localization: { i18nKey: 'httpErrors.record.notFound' },
    });
  }

  async resolveRecordIdsBySelection(
    tableId: string,
    selectionRo: Pick<
      ISelectionIdMutationBaseRo,
      | 'selection'
      | 'viewId'
      | 'ignoreViewQuery'
      | 'filter'
      | 'orderBy'
      | 'groupBy'
      | 'search'
      | 'collapsedGroupIds'
      | 'projection'
    >
  ): Promise<string[]> {
    const { selection, ...queryRo } = selectionRo;
    if (selection.recordIds) {
      return selection.recordIds;
    }

    const rangeQuery = await this.normalizeRangeQuery(tableId, queryRo);
    // Only record ids are needed here: load the table aggregate once and page
    // with an empty projection so no user-field cells are read or mapped.
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const context = await this.v2ContextFactory.createContext(container);
    const table = await this.loadV2Table(context, container, tableId);
    // One scope preparation for the whole sweep: plugin scope does not depend
    // on the page window, and re-running authz per 1000-id page dominated the
    // id-resolution cost on large selections.
    const pageSize = resolveSelectionRecordIdsIdsOnlyPageSize;
    const queryScope = await this.prepareRecordQueryScope(context, container, table, {
      kind: RecordQueryOperationKind.list,
      viewId: rangeQuery.viewId,
      ignoreViewQuery: rangeQuery.ignoreViewQuery,
      limit: pageSize,
      offset: 0,
    });
    const recordIds: string[] = [];
    let skip = 0;
    let hasMore = true;
    while (hasMore) {
      const pageQuery: IGetRecordsRo = {
        viewId: rangeQuery.viewId,
        ignoreViewQuery: rangeQuery.ignoreViewQuery,
        filter: rangeQuery.filter,
        orderBy: rangeQuery.orderBy,
        groupBy: rangeQuery.groupBy,
        search: rangeQuery.search,
        skip,
        // The effective page size travels as a host-only option; the request
        // limit stays within the public cap.
        take: maxResolveSelectionRecordIdsPageSize,
        fieldKeyType: FieldKeyType.Id,
      };
      const { result } = await this.getRecordsWithPreparedScope(
        tableId,
        pageQuery,
        queryScope,
        container,
        context,
        table,
        { projectionFieldIds: [], idsOnly: true, idsOnlyPageSize: pageSize }
      );
      for (const record of result.records) {
        recordIds.push(record.id);
      }
      hasMore = result.records.length === pageSize;
      skip += pageSize;
    }
    const excludedIds = new Set(selection.excludeRecordIds ?? []);
    return recordIds.filter((recordId) => !excludedIds.has(recordId));
  }

  private async withTableDataClient<T>(tableId: string, fn: () => Promise<T>): Promise<T> {
    const resolvedDataDb = await this.dataDbClientManager.getDataDatabaseForTable(tableId);
    if (resolvedDataDb.isMetaFallback) {
      return fn();
    }

    const dataPrisma = await this.dataDbClientManager.dataPrismaForTable(tableId);
    const cls = this.cls as unknown as ClsService<{ dataTx: { client?: unknown } }>;
    const store = cls.get();
    const previousClient = cls.get(dataTxClientKey);

    return cls.runWith(store, async () => {
      cls.set(dataTxClientKey, dataPrisma);
      try {
        return await fn();
      } finally {
        cls.set(dataTxClientKey, previousClient);
      }
    });
  }

  /**
   * Sign attachment download/preview URLs for pure-V2 JSON responses.
   *
   * Field discovery: V2 table aggregate. Signing: v2-core free function
   * {@link presignAttachmentFieldMaps} + container {@link IAttachmentUrlSignerService}
   * (Nest adapter looks up thumbnails and storage URLs). No RecordService.
   */
  private async presignAttachmentFieldsFromTable(
    container: DependencyContainer,
    table: Table,
    records: IRecord[],
    fieldKeyType: FieldKeyType
  ): Promise<IRecord[]> {
    if (!records.length) {
      return records;
    }
    if (!container.isRegistered(v2CoreTokens.attachmentUrlSignerService)) {
      return records;
    }

    const attachmentFieldKeys = new Set(
      table
        .getFields()
        .filter((field) => this.isAttachmentValueField(field))
        .map((field) => this.resolveResponseFieldKey(table, field.id().toString(), fieldKeyType))
    );
    if (!attachmentFieldKeys.size) {
      return records;
    }

    const signer = container.resolve<IAttachmentUrlSignerService>(
      v2CoreTokens.attachmentUrlSignerService
    );
    const signedFieldsResult = await presignAttachmentFieldMaps(
      records.map((record) => record.fields),
      attachmentFieldKeys,
      signer
    );
    if (signedFieldsResult.isErr()) {
      // Fail closed on presentation: return unsigned cells rather than 500 the list.
      return records;
    }

    const signedFieldMaps = signedFieldsResult.value;
    return records.map((record, index) => ({
      ...record,
      fields: signedFieldMaps[index] ?? record.fields,
    }));
  }

  private isAttachmentValueField(field: V2Field): boolean {
    return this.presentationFieldType(field) === 'attachment';
  }

  private presentationField(field: V2Field): V2Field {
    const fieldType = field.type().toString();
    if (fieldType !== 'lookup' && fieldType !== 'conditionalLookup') {
      return field;
    }
    const innerField =
      fieldType === 'lookup'
        ? (field as LookupField).innerField()
        : (field as ConditionalLookupField).innerField();
    return innerField.isOk() ? this.presentationField(innerField.value) : field;
  }

  private presentationFieldType(field: V2Field): string {
    return this.presentationField(field).type().toString();
  }

  private isPublicUserValueField(field: V2Field): boolean {
    return publicUserFieldTypes.has(this.presentationFieldType(field));
  }

  private async hydrateLegacyUserCells(
    container: DependencyContainer,
    table: Table,
    records: IRecord[],
    fieldKeyType: FieldKeyType
  ): Promise<IRecord[]> {
    const userFields = table
      .getFields()
      .filter((field) => this.isPublicUserValueField(field))
      .map((field) => ({
        key: this.resolveResponseFieldKey(table, field.id().toString(), fieldKeyType),
      }));
    if (!userFields.length || !records.length) {
      return records;
    }

    const userFieldKeys = new Set(userFields.map((field) => field.key));

    const userIds = new Set<string>();
    for (const record of records) {
      for (const key of userFieldKeys) {
        this.collectLegacyUserIds(record.fields[key], userIds);
      }
    }
    const resolvedUsers = userIds.size
      ? await this.resolvePublicUsers(container, userIds)
      : new Map<string, { id: string; title: string; email?: string }>();

    return records.map((record) => {
      const fields = { ...record.fields };
      for (const field of userFields) {
        if (field.key in fields) {
          fields[field.key] = this.normalizePublicUserValue(fields[field.key], resolvedUsers);
        }
      }
      return { ...record, fields };
    });
  }

  private collectLegacyUserIds(value: unknown, target: Set<string>): void {
    if (typeof value === 'string') {
      if (value.startsWith('usr')) target.add(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => this.collectLegacyUserIds(item, target));
      return;
    }
    if (value && typeof value === 'object') {
      const id = (value as { id?: unknown }).id;
      if (typeof id === 'string' && id.startsWith('usr')) target.add(id);
    }
  }

  private collectGroupUserIds(value: unknown, target: Set<string>): void {
    this.collectLegacyUserIds(value, target);
    if (Array.isArray(value)) {
      value.forEach((item) => this.collectGroupUserIds(item, target));
      return;
    }
    if (value && typeof value === 'object') {
      const id = (value as { id?: unknown }).id;
      if (typeof id === 'string' && id.startsWith('usr')) target.add(id);
    }
  }

  private async resolvePublicUsers(
    container: DependencyContainer,
    userIds: ReadonlySet<string>
  ): Promise<Map<string, { id: string; title: string; email?: string }>> {
    const resolvedUsers = new Map<string, { id: string; title: string; email?: string }>();
    if (!container.isRegistered(v2CoreTokens.userLookupService)) {
      return resolvedUsers;
    }
    try {
      const lookup = container.resolve<IUserLookupService>(v2CoreTokens.userLookupService);
      // Display enrichment for ids already stored in cells: keep resolving
      // deleted users so historical values retain their owner names.
      const result = await lookup.listUsersByIds([...userIds], { includeDeleted: true });
      if (result.isOk()) {
        for (const user of result.value) {
          resolvedUsers.set(user.id, {
            id: user.id,
            title: user.name,
            ...(user.email ? { email: user.email } : {}),
          });
        }
      }
    } catch {
      // Keep the public user-cell shape even when optional enrichment fails.
    }
    return resolvedUsers;
  }

  private normalizePublicUserValue(
    value: unknown,
    resolvedUsers: ReadonlyMap<string, { id: string; title: string; email?: string }>
  ): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.normalizePublicUserValue(item, resolvedUsers));
    }

    const id =
      typeof value === 'string'
        ? value
        : value && typeof value === 'object'
          ? (value as { id?: unknown }).id
          : undefined;
    if (typeof id !== 'string' || !id.startsWith('usr')) {
      return value;
    }

    const resolved = resolvedUsers.get(id);
    const existing = value && typeof value === 'object' ? value : {};
    return {
      ...existing,
      id,
      title:
        resolved?.title ??
        (typeof (existing as { title?: unknown }).title === 'string'
          ? (existing as { title: string }).title
          : id),
      ...(resolved?.email ? { email: resolved.email } : {}),
      avatarUrl: buildUserAvatarUrl(id),
    };
  }

  /**
   * Pure-V2 CellFormat.Text mapping from already-resolved cell values.
   * Prefer structural title/name for link/user cells; never "[object Object]".
   * Does not load V1 FieldService.
   */
  private formatRecordFieldsAsDisplayText(
    table: Table,
    records: IRecord[],
    fieldKeyType: FieldKeyType
  ): IRecord[] {
    if (!records.length) {
      return records;
    }

    const formatterByKey = new Map<string, IFieldInstance>();
    for (const field of table.getFields()) {
      const formatter = this.createDisplayFieldInstance(field);
      if (formatter) {
        formatterByKey.set(
          this.resolveResponseFieldKey(table, field.id().toString(), fieldKeyType),
          formatter
        );
      }
    }
    const primaryKey = this.resolveResponseFieldKey(
      table,
      table.primaryFieldId().toString(),
      fieldKeyType
    );

    return records.map((record) => {
      const nextFields: IRecord['fields'] = {};
      for (const [key, value] of Object.entries(record.fields)) {
        if (value == null) {
          continue;
        }
        nextFields[key] = this.formatCellValueWithField(formatterByKey.get(key), value);
      }
      return {
        ...record,
        fields: nextFields,
        name:
          primaryKey in record.fields
            ? this.formatCellValueWithField(
                formatterByKey.get(primaryKey),
                record.fields[primaryKey]
              )
            : this.primaryValueToRecordName(record.name),
      };
    });
  }

  private createDisplayFieldInstance(
    field: ReturnType<Table['getFields']>[number]
  ): IFieldInstance | undefined {
    const presentationField = this.presentationField(field);
    const valueTypeResult = field.accept(new FieldValueTypeVisitor());
    const optionsResult = presentationField.accept(new FieldOptionsDtoVisitor());
    if (valueTypeResult.isErr() || optionsResult.isErr()) {
      return undefined;
    }

    const type = presentationField.type().toString() as FieldType;
    const cellValueType = this.cellValueTypeFromV2ValueType(
      valueTypeResult.value.cellValueType.toString()
    );
    const isMultipleCellValue = valueTypeResult.value.isMultipleCellValue.toBoolean();
    try {
      return createFieldInstanceByVo({
        id: field.id().toString(),
        dbFieldName: field.id().toString(),
        name: field.name().toString(),
        type,
        options:
          optionsResult.value && typeof optionsResult.value === 'object'
            ? (optionsResult.value as IFieldVo['options'])
            : {},
        cellValueType,
        isMultipleCellValue,
        dbFieldType: getDbFieldType(type, cellValueType, isMultipleCellValue),
      });
    } catch {
      return undefined;
    }
  }

  private formatCellValueWithField(field: IFieldInstance | undefined, value: unknown): string {
    if (field) {
      try {
        return field.cellValue2String(value) ?? '';
      } catch {
        // Malformed legacy cells should not fail the entire records endpoint.
      }
    }
    return this.cellValueToDisplayText(value);
  }

  private primaryValueToRecordName(value: unknown): string {
    if (value == null) {
      return '';
    }
    if (typeof value === 'string') {
      return value;
    }
    return this.cellValueToDisplayText(value);
  }

  private cellValueToDisplayText(value: unknown): string {
    if (value == null) {
      return '';
    }
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (Array.isArray(value)) {
      return value
        .map((entry) => this.cellValueToDisplayText(entry))
        .filter((entry) => entry.length > 0)
        .join(', ');
    }
    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      if (typeof obj.title === 'string') {
        return obj.title;
      }
      if (typeof obj.name === 'string') {
        return obj.name;
      }
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }
    return String(value);
  }

  /**
   * Format top-level system datetime fields using V2 table aggregate field defs
   * (CreatedTime / LastModifiedTime formatting), not FieldService.
   */
  private formatSystemDatetimeFieldsFromTable(
    table: Table,
    records: IRecord[],
    cellFormat?: CellFormat,
    sortedFieldIds?: ReadonlyArray<string>
  ): IRecord[] {
    if (!records.length || cellFormat === CellFormat.Text || !sortedFieldIds?.length) {
      return records;
    }

    const sortedFieldIdSet = new Set(sortedFieldIds);
    const formatters = table.getFields().flatMap((field) => {
      const fieldId = field.id().toString();
      if (!sortedFieldIdSet.has(fieldId)) {
        return [];
      }
      const fieldType = field.type().toString();
      if (fieldType !== 'createdTime' && fieldType !== 'lastModifiedTime') {
        return [];
      }
      const formattingDto =
        'formatting' in field && typeof field.formatting === 'function'
          ? (
              field as {
                formatting: () => { toDto: () => IDatetimeFormatting };
              }
            )
              .formatting()
              .toDto()
          : undefined;
      if (!formattingDto || formattingDto.time !== TimeFormatting.None) {
        return [];
      }
      return [
        {
          topLevelKey:
            fieldType === 'createdTime' ? ('createdTime' as const) : ('lastModifiedTime' as const),
          formatting: formattingDto,
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

  private toProjectionMap(
    fieldKeys?: string | ReadonlyArray<string>
  ): Record<string, boolean> | undefined {
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
    fieldKeyType: FieldKeyType,
    enabledFieldIds?: ReadonlyArray<string>
  ): Promise<Record<string, boolean> | undefined> {
    const explicitProjection = this.toProjectionMap(
      query.projection as unknown as string | string[]
    );
    if (explicitProjection) {
      return explicitProjection;
    }

    if (enabledFieldIds != null) {
      if (!enabledFieldIds.length) {
        return {};
      }
      if (fieldKeyType === FieldKeyType.Id) {
        return this.toProjectionMap(enabledFieldIds);
      }
    }

    if (enabledFieldIds == null && (query.ignoreViewQuery || !query.viewId)) {
      return undefined;
    }

    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const context = await this.v2ContextFactory.createContext(container);
    const table = await this.loadV2Table(context, container, tableId);
    const enabled = enabledFieldIds != null ? new Set(enabledFieldIds) : undefined;
    let fields = table
      .getFields()
      .filter((field) => (enabled ? enabled.has(field.id().toString()) : true));
    if (query.viewId && !query.ignoreViewQuery && enabled == null) {
      const ordered = table.getOrderedVisibleFieldIds(query.viewId);
      if (ordered.isOk()) {
        fields = ordered.value.flatMap((fieldId) => {
          const field = table.getField((candidate) => candidate.id().equals(fieldId));
          return field.isOk() ? [field.value] : [];
        });
      }
    }

    const projectionKeys = fields
      .map((field) => {
        if (fieldKeyType === FieldKeyType.Id) {
          return field.id().toString();
        }
        if (fieldKeyType === FieldKeyType.Name) {
          return field.name().toString();
        }
        const dbFieldName = field.dbFieldName();
        return dbFieldName.isOk() ? dbFieldName.value.toString() : field.name().toString();
      })
      .filter((key): key is string => Boolean(key));

    return this.toProjectionMap(projectionKeys);
  }

  private async executeListRecordsEndpoint(
    input: IListTableRecordsQueryInput,
    context: IExecutionContext,
    queryBus: IQueryBus,
    options?: {
      queryScope?: RecordQueryPluginScope;
      recordReadQuerySource?: IRecordReadQuerySource;
      recordSearchAccessPath?: IRecordSearchAccessPath;
    }
  ): Promise<{
    records: Array<{ id: string; fields: Record<string, unknown> }>;
    pagination: { hasMore: boolean };
  }> {
    const result = await executeListTableRecordsEndpoint(context, input, queryBus, options);
    if (result.status === 200 && result.body.ok) {
      return {
        records: result.body.data.records as Array<{ id: string; fields: Record<string, unknown> }>,
        pagination: {
          hasMore: result.body.data.pagination.hasMore,
        },
      };
    }

    if (!result.body.ok) {
      throwV2Error(result.body.error, result.status);
    }

    throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  /**
   * Pure-V2 list path: executes ListTableRecordsQuery and returns full read models
   * (including system columns) without the HTTP DTO strip.
   */
  private async executeListTableRecordsQuery(
    input: IListTableRecordsQueryInput,
    context: IExecutionContext,
    queryBus: IQueryBus,
    options?: {
      queryScope?: RecordQueryPluginScope;
      recordSearchAccessPath?: IRecordSearchAccessPath;
      includeGroupMetadata?: boolean;
      groupLimit?: number;
      includeSearchFieldMatches?: boolean;
      searchFieldScope?: 'projection' | 'visible';
      searchIndexMode?: 'matched' | 'view';
      requireReadableSearchFields?: boolean;
      idsOnly?: boolean;
      idsOnlyPageSize?: number;
      table?: Table;
    }
  ): Promise<{
    records: ReadonlyArray<TableRecordReadModel>;
    total: number;
    groups?: ReadonlyArray<ITableRecordGroup>;
    searchMatches?: ListTableRecordsResult['searchMatches'];
    appliedGroup?: ListTableRecordsResult['appliedGroup'];
  }> {
    const queryResult = ListTableRecordsQuery.create(input, options);
    if (queryResult.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(queryResult.error),
        mapDomainErrorToHttpStatus(queryResult.error)
      );
    }

    const result = await queryBus.execute<ListTableRecordsQuery, ListTableRecordsResult>(
      context,
      queryResult.value
    );
    if (result.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(result.error),
        mapDomainErrorToHttpStatus(result.error)
      );
    }

    return {
      records: result.value.records,
      total: result.value.total,
      ...(result.value.groups ? { groups: result.value.groups } : {}),
      ...(result.value.searchMatches ? { searchMatches: result.value.searchMatches } : {}),
      ...(result.value.appliedGroup ? { appliedGroup: result.value.appliedGroup } : {}),
    };
  }

  private async loadV2Table(
    context: IExecutionContext,
    container: DependencyContainer,
    tableId: string
  ): Promise<Table> {
    const tableIdResult = TableId.create(tableId);
    if (tableIdResult.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(tableIdResult.error),
        mapDomainErrorToHttpStatus(tableIdResult.error)
      );
    }
    const tableRepository = container.resolve<ITableRepository>(v2CoreTokens.tableRepository);
    const tableResult = await tableRepository.findOne(
      context,
      TableByIdSpec.create(tableIdResult.value)
    );
    if (tableResult.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(tableResult.error),
        mapDomainErrorToHttpStatus(tableResult.error)
      );
    }
    return tableResult.value;
  }

  /**
   * Host-controlled existence probe for 403 vs 404 after a scoped getOne miss.
   *
   * Re-prepares plugins as **getOne** with `existenceProbe: true` so only plugins
   * that honor that intent (authority matrix) drop their discretionary row filter.
   * Other plugins keep their recordSpec. Never sets global skipRecordSpec on a
   * pre-merged scope.
   */
  private async probeRecordExistsOutsideDiscretionaryRowFilter(
    tableId: string,
    recordId: string,
    getOneScope: RecordQueryPluginScope | undefined,
    container: DependencyContainer,
    context: IExecutionContext,
    table: Table
  ): Promise<boolean> {
    // No row filter was applied on the miss — cannot distinguish 403 vs 404.
    if (!getOneScope?.recordSpec) {
      return false;
    }
    const probeScope = await this.prepareRecordQueryScope(context, container, table, {
      kind: RecordQueryOperationKind.getOne,
      recordId,
      ignoreViewQuery: true,
      existenceProbe: true,
    });
    const queryBus = container.resolve<IQueryBus>(v2CoreTokens.queryBus);
    const listResult = await this.executeListTableRecordsQuery(
      {
        tableId,
        fieldKeyType: FieldKeyType.Id,
        limit: 1,
        offset: 0,
        projection: [],
        includeTotal: false,
        selectedRecordIds: [recordId],
        ignoreViewQuery: true,
      },
      context,
      queryBus,
      {
        ...(probeScope ? { queryScope: probeScope } : {}),
      }
    );
    return listResult.records.length > 0;
  }

  private async prepareRecordQueryScope(
    context: IExecutionContext,
    container: DependencyContainer,
    table: Table,
    payload:
      | {
          kind: typeof RecordQueryOperationKind.list;
          viewId?: string;
          ignoreViewQuery?: boolean;
          limit?: number;
          offset?: number;
          projectionFieldIds?: ReadonlyArray<string>;
          keepPrimaryKey?: boolean;
        }
      | {
          kind: typeof RecordQueryOperationKind.getOne;
          recordId: string;
          viewId?: string;
          ignoreViewQuery?: boolean;
          projectionFieldIds?: ReadonlyArray<string>;
          /** See RecordQueryGetOnePayload.existenceProbe */
          existenceProbe?: boolean;
        }
      | {
          kind: typeof RecordQueryOperationKind.getByIds;
          recordIds: ReadonlyArray<string>;
          viewId?: string;
          ignoreViewQuery?: boolean;
          projectionFieldIds?: ReadonlyArray<string>;
          keepPrimaryKey?: boolean;
        }
  ): Promise<RecordQueryPluginScope | undefined> {
    if (!container.isRegistered(v2CoreTokens.recordQueryPluginRunner)) {
      return undefined;
    }
    const runner = container.resolve<RecordQueryPluginRunner>(v2CoreTokens.recordQueryPluginRunner);
    const prepared =
      payload.kind === RecordQueryOperationKind.getOne
        ? await runner.prepare({
            kind: RecordQueryOperationKind.getOne,
            executionContext: context,
            table,
            payload: {
              recordId: payload.recordId,
              viewId: payload.viewId,
              ignoreViewQuery: payload.ignoreViewQuery,
              projectionFieldIds: payload.projectionFieldIds,
              existenceProbe: payload.existenceProbe,
            },
          })
        : payload.kind === RecordQueryOperationKind.getByIds
          ? await runner.prepare({
              kind: RecordQueryOperationKind.getByIds,
              executionContext: context,
              table,
              payload: {
                recordIds: payload.recordIds,
                viewId: payload.viewId,
                ignoreViewQuery: payload.ignoreViewQuery,
                projectionFieldIds: payload.projectionFieldIds,
                keepPrimaryKey: payload.keepPrimaryKey,
              },
            })
          : await runner.prepare({
              kind: RecordQueryOperationKind.list,
              executionContext: context,
              table,
              payload: {
                viewId: payload.viewId,
                ignoreViewQuery: payload.ignoreViewQuery,
                projectionFieldIds: payload.projectionFieldIds,
                limit: payload.limit,
                offset: payload.offset,
                keepPrimaryKey: payload.keepPrimaryKey,
              },
            });
    if (prepared.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(prepared.error),
        mapDomainErrorToHttpStatus(prepared.error)
      );
    }
    const execution = prepared.value;
    const guardResult = await execution.guard();
    if (guardResult.isErr()) {
      const status = isForbiddenError(guardResult.error)
        ? HttpStatus.FORBIDDEN
        : mapDomainErrorToHttpStatus(guardResult.error);
      throwV2Error(mapDomainErrorToHttpError(guardResult.error), status);
    }
    const scopeResult = execution.getScope();
    if (scopeResult.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(scopeResult.error),
        mapDomainErrorToHttpStatus(scopeResult.error)
      );
    }
    return scopeResult.value;
  }

  /**
   * Resolve list projection to field **ids** from the V2 table aggregate only.
   *
   * Projection keys may be ids, names, or dbFieldNames depending on
   * `fieldKeyType` (EE `getProjectionWithPermission` often returns names).
   * Always normalize to field ids before ListTableRecords.
   */
  private resolveListProjectionFieldIdsFromTable(
    table: Table,
    query: IGetRecordsRo,
    enabledFieldIds?: ReadonlyArray<string>
  ): string[] {
    // Empty allow-list means no user fields (not unrestricted).
    if (enabledFieldIds != null && enabledFieldIds.length === 0) {
      return [];
    }

    const allowSet = enabledFieldIds != null ? new Set(enabledFieldIds) : undefined;
    const intersectAllow = (ids: ReadonlyArray<string>) =>
      allowSet ? ids.filter((id) => allowSet.has(id)) : [...ids];

    const fieldKeyType = query.fieldKeyType ?? FieldKeyType.Name;
    const explicitProjection = Array.isArray(query.projection)
      ? query.projection.filter((key): key is string => typeof key === 'string' && key.length > 0)
      : undefined;
    if (explicitProjection?.length) {
      const resolvedIds = this.resolveProjectionKeysToFieldIds(
        table,
        explicitProjection,
        fieldKeyType
      );
      return intersectAllow(resolvedIds);
    }

    // Restricted role without client projection: allow-list *is* the projection
    // (matrix already scoped to this table's fields).
    if (allowSet) {
      return [...allowSet];
    }

    if (query.viewId && !query.ignoreViewQuery) {
      const visibleResult = table.getOrderedVisibleFieldIds(query.viewId);
      if (visibleResult.isOk()) {
        return visibleResult.value.map((fieldId) => fieldId.toString());
      }
      // View missing: fall through to all table fields.
    }

    return table.fieldIds().map((fieldId) => fieldId.toString());
  }

  /**
   * Map projection keys (id / name / dbFieldName) to field ids via table aggregate.
   */
  private resolveProjectionKeysToFieldIds(
    table: Table,
    keys: ReadonlyArray<string>,
    fieldKeyType: FieldKeyType
  ): string[] {
    if (fieldKeyType === FieldKeyType.Id || (fieldKeyType as string) === 'id') {
      return [...keys];
    }

    const byName = new Map<string, string>();
    const byDbName = new Map<string, string>();
    for (const field of table.getFields()) {
      const id = field.id().toString();
      byName.set(field.name().toString(), id);
      const dbResult = field.dbFieldName();
      if (dbResult.isOk()) {
        const valueResult = dbResult.value.value();
        if (valueResult.isOk() && valueResult.value) {
          byDbName.set(valueResult.value, id);
        }
      }
    }

    const resolved: string[] = [];
    const seen = new Set<string>();
    for (const key of keys) {
      let fieldId: string | undefined;
      if (fieldKeyType === FieldKeyType.Name || (fieldKeyType as string) === 'name') {
        fieldId = byName.get(key) ?? (key.startsWith('fld') ? key : undefined);
      } else {
        fieldId = byDbName.get(key) ?? byName.get(key) ?? (key.startsWith('fld') ? key : undefined);
      }
      if (fieldId && !seen.has(fieldId)) {
        seen.add(fieldId);
        resolved.push(fieldId);
      }
    }
    return resolved;
  }

  private mapTableRecordReadModelToIRecord(
    table: Table,
    record: TableRecordReadModel,
    primaryFieldId: string,
    fieldKeyType: FieldKeyType,
    idResponsePlan: IIdRecordResponsePlan | undefined,
    primaryFormatter: IFieldInstance | undefined
  ): IRecord {
    const fields = idResponsePlan
      ? this.normalizeIdKeyedRecordFields(record, idResponsePlan)
      : this.mapNonIdRecordFields(table, record, fieldKeyType);
    const primaryKey = idResponsePlan
      ? primaryFieldId
      : this.resolveResponseFieldKey(table, primaryFieldId, fieldKeyType);
    const primaryValue = fields[primaryKey] ?? record.fields[primaryFieldId];
    return {
      id: record.id,
      fields,
      name: this.formatCellValueWithField(primaryFormatter, primaryValue),
      autoNumber: record.autoNumber,
      createdTime: record.createdTime,
      lastModifiedTime: record.lastModifiedTime,
      createdBy: record.createdBy,
      lastModifiedBy: record.lastModifiedBy,
    };
  }

  private createIdRecordResponsePlan(table: Table): IIdRecordResponsePlan {
    const checkboxFieldIds = new Set<string>();
    const auditFallbacks: Array<IIdRecordResponsePlan['auditFallbacks'][number]> = [];

    for (const field of table.getFields()) {
      const fieldId = field.id().toString();
      const fieldType = field.type().toString();
      if (fieldType === 'checkbox') {
        checkboxFieldIds.add(fieldId);
      } else if (fieldType === 'createdBy') {
        auditFallbacks.push({ fieldId, source: 'createdBy' });
      } else if (fieldType === 'lastModifiedBy' && (field as LastModifiedByField).isTrackAll()) {
        auditFallbacks.push({ fieldId, source: 'lastModifiedBy' });
      }
    }

    return {
      checkboxFieldIds,
      auditFallbacks,
    };
  }

  private normalizeIdKeyedRecordFields(
    record: TableRecordReadModel,
    plan: IIdRecordResponsePlan
  ): Record<string, unknown> {
    const fields: Record<string, unknown> = {};
    for (const [fieldId, value] of Object.entries(record.fields)) {
      if (value == null || (value === false && plan.checkboxFieldIds.has(fieldId))) {
        continue;
      }
      fields[fieldId] = value;
    }

    for (const fallback of plan.auditFallbacks) {
      if (record.fields[fallback.fieldId] != null) {
        continue;
      }
      const userId = fallback.source === 'createdBy' ? record.createdBy : record.lastModifiedBy;
      if (userId) {
        fields[fallback.fieldId] = this.systemAuditUserFallback(userId);
      }
    }
    return fields;
  }

  private mapNonIdRecordFields(
    table: Table,
    record: TableRecordReadModel,
    fieldKeyType: FieldKeyType
  ): Record<string, unknown> {
    const rawFields = { ...record.fields };
    for (const field of table.getFields()) {
      const fieldId = field.id().toString();
      if (rawFields[fieldId] != null) {
        continue;
      }
      const fieldType = field.type().toString();
      if (fieldType === 'createdBy' && record.createdBy) {
        rawFields[fieldId] = this.systemAuditUserFallback(record.createdBy);
      } else if (
        fieldType === 'lastModifiedBy' &&
        (field as LastModifiedByField).isTrackAll() &&
        record.lastModifiedBy
      ) {
        rawFields[fieldId] = this.systemAuditUserFallback(record.lastModifiedBy);
      }
    }
    return this.remapRecordFieldsFromTable(table, rawFields, fieldKeyType);
  }

  private systemAuditUserFallback(userId: string): {
    id: string;
    title: string;
    avatarUrl: string;
  } {
    return {
      id: userId,
      title: userId,
      avatarUrl: buildUserAvatarUrl(userId),
    };
  }

  /**
   * Remap id-keyed cell map to the requested OpenAPI fieldKeyType using the
   * V2 table aggregate only (names / dbFieldNames live on domain fields).
   *
   * V1 parity: omit null/undefined cells (and unchecked checkbox `false`) so
   * clients and e2e asserts see missing keys, not explicit nulls.
   */
  private remapRecordFieldsFromTable(
    table: Table,
    fields: Record<string, unknown>,
    fieldKeyType: FieldKeyType
  ): Record<string, unknown> {
    const byId = new Map(table.getFields().map((field) => [field.id().toString(), field]));
    const remapped: Record<string, unknown> = {};
    for (const [fieldId, value] of Object.entries(fields)) {
      if (value == null) {
        continue;
      }
      const field = byId.get(fieldId);
      // Unchecked checkbox is null in V1 JSON responses.
      if (value === false && field?.type().toString() === 'checkbox') {
        continue;
      }
      if (this.isIdFieldKeyType(fieldKeyType)) {
        remapped[fieldId] = value;
        continue;
      }
      if (!field) {
        remapped[fieldId] = value;
        continue;
      }
      remapped[this.resolveResponseFieldKey(table, fieldId, fieldKeyType)] = value;
    }
    return remapped;
  }

  private isIdFieldKeyType(fieldKeyType: FieldKeyType): boolean {
    return fieldKeyType === FieldKeyType.Id || (fieldKeyType as string) === 'id';
  }

  private resolveResponseFieldKey(
    table: Table,
    fieldId: string,
    fieldKeyType: FieldKeyType
  ): string {
    if (this.isIdFieldKeyType(fieldKeyType)) {
      return fieldId;
    }
    const field = table.getFields().find((item) => item.id().toString() === fieldId);
    if (!field) {
      return fieldId;
    }
    if (fieldKeyType === FieldKeyType.Name || (fieldKeyType as string) === 'name') {
      return field.name().toString();
    }
    // dbFieldName — fall back to name when physical name is unset.
    const dbFieldNameResult = field.dbFieldName();
    if (dbFieldNameResult.isOk()) {
      const valueResult = dbFieldNameResult.value.value();
      if (valueResult.isOk() && valueResult.value) {
        return valueResult.value;
      }
    }
    return field.name().toString();
  }

  private async resolveRecordSearchAccessPath(
    context: IExecutionContext,
    tableId: string,
    container: DependencyContainer,
    search: IGetRecordsRo['search']
  ): Promise<IRecordSearchAccessPath | undefined> {
    const runtimeService = this.tableQuerySearchVectorRuntimeService;
    if (!runtimeService) {
      return undefined;
    }

    return await this.withRecordReadSpan(
      context,
      'teable.RecordOpenApiV2Service.resolveRecordSearchAccessPath',
      {
        'record.read.has_search': Boolean(search),
      },
      () =>
        runtimeService.resolveForRecordSearch({
          container,
          tableId,
          search,
        })
    );
  }

  /**
   * Resolve orderBy/groupBy field keys (name / dbFieldName / id) to field ids.
   */
  private resolveSortGroupFieldKeysToIds<
    T extends { fieldId: string; order?: string } | { fieldId: string; order: string },
  >(table: Table, items: ReadonlyArray<T> | undefined): T[] | undefined {
    if (!items?.length) {
      return items as T[] | undefined;
    }
    const byId = new Set(table.getFields().map((field) => field.id().toString()));
    const byName = new Map(
      table.getFields().map((field) => [field.name().toString(), field.id().toString()])
    );
    const byDbName = new Map<string, string>();
    for (const field of table.getFields()) {
      const dbResult = field.dbFieldName();
      if (dbResult.isOk()) {
        const valueResult = dbResult.value.value();
        if (valueResult.isOk() && valueResult.value) {
          byDbName.set(valueResult.value, field.id().toString());
        }
      }
    }
    const resolved: T[] = [];
    for (const item of items) {
      const fieldId = byId.has(item.fieldId)
        ? item.fieldId
        : byName.get(item.fieldId) ?? byDbName.get(item.fieldId);
      if (!fieldId) {
        continue;
      }
      resolved.push({ ...item, fieldId });
    }
    return resolved.length ? resolved : undefined;
  }

  private shouldLoadQueryExtra(
    query: IGetRecordsRo,
    recordSearchAccessPath?: IRecordSearchAccessPath
  ): boolean {
    if (query.includeQueryExtra === false) {
      return false;
    }
    if (query.groupBy?.length || query.collapsedGroupIds?.length) {
      return true;
    }
    if (
      (recordSearchAccessPath?.kind === 'generated_tsvector' ||
        recordSearchAccessPath?.kind === 'generated_text') &&
      query.search &&
      query.includeQueryExtra !== true
    ) {
      return false;
    }
    return Boolean(query.search);
  }

  /**
   * V1-contract extra.searchHitIndex from the V2 list result's own search
   * matches — same page, same scope, no V1 involvement. The row search runs
   * over all visible fields (searchFieldScope 'visible'); like V1, only hits
   * in projected fields surface in the extra. Empty projection (ShareDB
   * doc-ids) is not a field deny-list: keep every match. No hits on a
   * searched page → null.
   */
  private buildSearchHitIndexExtra(
    enabled: boolean,
    searchMatches: ListTableRecordsResult['searchMatches'],
    projectionFieldIds: ReadonlyArray<string>
  ): IRecordsVo['extra'] | undefined {
    if (!enabled) {
      return undefined;
    }
    const projected = new Set(projectionFieldIds);
    const searchHitIndex = (searchMatches ?? [])
      .filter((match) => projected.size === 0 || projected.has(match.fieldId.toString()))
      .map((match) => ({
        fieldId: match.fieldId.toString(),
        recordId: match.recordId.toString(),
      }));
    return { searchHitIndex: searchHitIndex.length ? searchHitIndex : null };
  }

  private async withRecordReadSpan<T>(
    context: IExecutionContext,
    name: string,
    attributes: Record<string, string | number | boolean>,
    callback: () => Promise<T>
  ): Promise<T> {
    const span = context.tracer?.startSpan(name, attributes);
    if (!span || !context.tracer) {
      return await callback();
    }

    return await context.tracer.withSpan(span, async () => {
      try {
        return await callback();
      } catch (error) {
        span.recordError(describeTraceError(error));
        throw error;
      } finally {
        span.end();
      }
    });
  }

  private withRecordReadSyncSpan<T>(
    context: IExecutionContext,
    name: string,
    attributes: Record<string, string | number | boolean>,
    callback: () => T
  ): T {
    const span = context.tracer?.startSpan(name, attributes);
    if (!span) {
      return callback();
    }

    try {
      return callback();
    } catch (error) {
      span.recordError(describeTraceError(error));
      throw error;
    } finally {
      span.end();
    }
  }

  async updateRecord(
    tableId: string,
    recordId: string,
    updateRecordRo: IUpdateRecordRo
  ): Promise<IRecord> {
    await this.assertTableRecordWritable(tableId);
    const order = updateRecordRo.order;
    const hasOrder = Boolean(order);
    const fields = updateRecordRo.record.fields ?? {};
    const hasFields = Object.keys(fields).length > 0;

    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext(container);

    if (hasFields || (hasOrder && order)) {
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
          throwV2Error(result.body.error, result.status);
        }
        throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
      }

      await this.clearUndoRedoEnginePreference(tableId);

      return result.body.data.record;
    }
    throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  async buttonClick(
    tableId: string,
    recordId: string,
    fieldId: string,
    shareScope?: {
      viewId: string;
      includeHiddenFields: boolean;
      includeRecords: boolean;
    }
  ): Promise<IButtonClickVo> {
    await this.assertTableRecordWritable(tableId);
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext(container);
    const command = ClickButtonCommand.create({
      tableId,
      recordId,
      fieldId,
      shareScope,
    });
    if (command.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(command.error),
        mapDomainErrorToHttpStatus(command.error)
      );
    }
    const result = await commandBus.execute<ClickButtonCommand, ClickButtonResult>(
      context,
      command.value
    );
    if (result.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(result.error),
        mapDomainErrorToHttpStatus(result.error)
      );
    }
    const record: IRecord = {
      id: result.value.record.id().toString(),
      fields: Object.fromEntries(
        result.value.record
          .fields()
          .entries()
          .map(({ fieldId: resultFieldId, value }) => [resultFieldId.toString(), value.toValue()])
      ),
    };
    await this.clearUndoRedoEnginePreference(tableId);
    return {
      runId: result.value.runId,
      tableId: result.value.tableId,
      fieldId: result.value.fieldId,
      record,
    };
  }

  async buttonReset(tableId: string, recordId: string, fieldId: string): Promise<IRecord> {
    await this.assertTableRecordWritable(tableId);
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext(container);
    const command = ResetButtonCommand.create({ tableId, recordId, fieldId });
    if (command.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(command.error),
        mapDomainErrorToHttpStatus(command.error)
      );
    }
    const result = await commandBus.execute<ResetButtonCommand, ResetButtonResult>(
      context,
      command.value
    );
    if (result.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(result.error),
        mapDomainErrorToHttpStatus(result.error)
      );
    }
    const fields = Object.fromEntries(
      result.value.record
        .fields()
        .entries()
        .filter(({ value }) => value.toValue() != null)
        .map(({ fieldId: resultFieldId, value }) => [resultFieldId.toString(), value.toValue()])
    );
    await this.clearUndoRedoEnginePreference(tableId);
    return { id: result.value.record.id().toString(), fields };
  }

  async updateRecords(
    tableId: string,
    updateRecordsRo: IUpdateRecordsRo,
    options?: {
      recordWritePluginRunnerOptions?: RecordWritePluginRunnerOptions;
    }
  ): Promise<IRecord[]> {
    await this.assertTableRecordWritable(tableId);
    const records = updateRecordsRo.records ?? [];
    const recordIds = records.map((record) => record.id);
    if (recordIds.length === 0) {
      return [];
    }

    const routeSpan = trace.getActiveSpan();
    const uniqueFieldIds = new Set<string>();
    let totalFieldAssignments = 0;
    for (const record of records) {
      const fieldIds = Object.keys(record.fields);
      totalFieldAssignments += fieldIds.length;
      for (const fieldId of fieldIds) {
        uniqueFieldIds.add(fieldId);
      }
    }
    routeSpan?.setAttributes({
      'teable.table_id': tableId,
      'record.update.request.recordCount': recordIds.length,
      'record.update.request.uniqueFieldCount': uniqueFieldIds.size,
      'record.update.request.totalFieldAssignments': totalFieldAssignments,
      'record.update.request.hasOrder': Boolean(updateRecordsRo.order),
      'record.update.request.typecast': updateRecordsRo.typecast ?? false,
    });

    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext(container);
    const updateResult = await executeUpdateRecordsEndpoint(
      context,
      {
        tableId,
        records,
        typecast: updateRecordsRo.typecast ?? false,
        fieldKeyType: updateRecordsRo.fieldKeyType ?? FieldKeyType.Name,
        ...(updateRecordsRo.order ? { order: updateRecordsRo.order } : {}),
      },
      commandBus,
      {
        recordWritePluginRunnerOptions: options?.recordWritePluginRunnerOptions,
      }
    );
    if (!(updateResult.status === 200 && updateResult.body.ok)) {
      if (!updateResult.body.ok) {
        throwV2Error(updateResult.body.error, updateResult.status);
      }
      throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
    }

    await this.clearUndoRedoEnginePreference(tableId);

    if (!updateResult.body.data.records) {
      throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
    }

    routeSpan?.setAttribute(
      'record.update.response.recordCount',
      updateResult.body.data.records.length
    );
    return updateResult.body.data.records;
  }

  private async getValidateAttachmentRecord(tableId: string, recordId: string, fieldId: string) {
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const context = await this.v2ContextFactory.createContext(container);
    const table = await this.loadV2Table(context, container, tableId);
    const fieldResult = table.getField((candidate) => candidate.id().toString() === fieldId);
    if (fieldResult.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(fieldResult.error),
        mapDomainErrorToHttpStatus(fieldResult.error)
      );
    }
    const field = fieldResult.value;
    if (!field.type().equals(V2FieldType.attachment())) {
      throw new CustomHttpException('Field is not an attachment', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.field.notAttachment',
        },
      });
    }
    if (field.computed().toBoolean()) {
      throw new CustomHttpException('Field is computed', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.field.isComputed',
        },
      });
    }

    return await this.getRecord(tableId, recordId, {
      fieldKeyType: FieldKeyType.Id,
      projection: [fieldId],
    });
  }

  async uploadAttachment(
    tableId: string,
    recordId: string,
    fieldId: string,
    file?: Express.Multer.File,
    fileUrl?: string
  ) {
    await this.assertTableRecordWritable(tableId);
    if (!file && !fileUrl) {
      throw new CustomHttpException('No file or URL provided', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.record.noFileOrUrlProvided',
        },
      });
    }

    if (!this.attachmentsService) {
      throw new CustomHttpException(internalServerError, HttpErrorCode.INTERNAL_SERVER_ERROR);
    }

    const record = await this.getValidateAttachmentRecord(tableId, recordId, fieldId);
    const attachmentItem = file
      ? await this.attachmentsService.uploadFile(file)
      : await this.attachmentsService.uploadFromUrl(fileUrl as string);

    return await this.updateRecord(tableId, recordId, {
      fieldKeyType: FieldKeyType.Id,
      record: {
        fields: {
          [fieldId]: ((record.fields[fieldId] || []) as IAttachmentItem[]).concat(attachmentItem),
        },
      },
    });
  }

  async insertAttachment(
    tableId: string,
    recordId: string,
    fieldId: string,
    attachments: IAttachmentItem[],
    anchorId?: string
  ) {
    await this.assertTableRecordWritable(tableId);
    if (!attachments.length) {
      throw new CustomHttpException('No attachments provided', HttpErrorCode.VALIDATION_ERROR);
    }

    const record = await this.getValidateAttachmentRecord(tableId, recordId, fieldId);
    const current = (record.fields[fieldId] || []) as IAttachmentItem[];
    const anchorIndex = anchorId ? current.findIndex((item) => item.id === anchorId) : -1;
    const next =
      anchorIndex >= 0
        ? [...current.slice(0, anchorIndex + 1), ...attachments, ...current.slice(anchorIndex + 1)]
        : current.concat(attachments);

    return await this.updateRecord(tableId, recordId, {
      fieldKeyType: FieldKeyType.Id,
      record: {
        fields: {
          [fieldId]: next,
        },
      },
    });
  }

  async createRecords(
    tableId: string,
    createRecordsRo: ICreateRecordsRo,
    _isAiInternal?: string,
    options?: { source?: RecordCreateSource }
  ): Promise<ICreateRecordsVo> {
    await this.assertTableRecordWritable(tableId);
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext(container);

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
      commandBus,
      options
    );

    if (result.status === 201 && result.body.ok) {
      await this.clearUndoRedoEnginePreference(tableId);
      return {
        records: result.body.data.records as IRecord[],
      };
    }

    if (!result.body.ok) {
      throwV2Error(result.body.error, result.status);
    }

    throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  async formSubmit(tableId: string, formSubmitRo: IFormSubmitRo): Promise<IRecord> {
    await this.assertTableRecordWritable(tableId);
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext(container);

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
      return result.body.data.record as IRecord;
    }

    if (!result.body.ok) {
      throwV2Error(result.body.error, result.status);
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
    await this.assertTableRecordWritable(tableId);
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext(container);
    const preparedPaste = await this.preparePasteCommandInput(tableId, pasteRo, options);
    const result = await executePasteEndpoint(context, preparedPaste.commandInput, commandBus);

    if (result.status === 200 && result.body.ok) {
      await this.clearUndoRedoEnginePreference(tableId);

      // V2 returns { updatedCount, createdCount, createdRecordIds }
      // V1 expects { ranges: [[startCol, startRow], [endCol, endRow]] }
      // Use truncatedRows (content size) for range calculation, not operation count,
      // because some rows may be skipped due to permission filters
      const finalCols = preparedPaste.finalContent[0]?.length ?? 1;

      // Note: Record creation and schema expansion undo/redo are handled by V2.

      // Best-effort: normalize v1 range formats (cell/rows/columns) into a cell range.
      // v1 "ranges" uses `cellSchema` for all modes:
      // - default: [col, row]
      // - columns: [startCol, endCol]
      // - rows: [startRow, endRow]
      if (preparedPaste.type === 'columns') {
        const endCol = preparedPaste.startCol + finalCols - 1;
        return {
          ranges: [
            [preparedPaste.startCol, 0],
            [endCol, Math.max(preparedPaste.truncatedRows - 1, 0)],
          ],
        };
      }

      if (preparedPaste.type === 'rows') {
        const endRow = preparedPaste.ranges[0]![1];
        return {
          ranges: [
            [0, preparedPaste.startRow],
            [Math.max(finalCols - 1, 0), endRow],
          ],
        };
      }

      const endRow = preparedPaste.startRow + Math.max(preparedPaste.truncatedRows - 1, 0);
      const endCol = preparedPaste.startCol + finalCols - 1;
      return {
        ranges: [
          [preparedPaste.startCol, preparedPaste.startRow],
          [endCol, Math.max(endRow, preparedPaste.startRow)],
        ],
      };
    }

    if (!result.body.ok) {
      throwV2Error(result.body.error, result.status);
    }

    throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  async pasteStream(
    tableId: string,
    pasteRo: IPasteRo,
    options?: {
      updateFilter?: IFilterSet | null;
      windowId?: string;
      allowFieldExpansion?: boolean;
      allowRecordExpansion?: boolean;
    }
  ): Promise<AsyncIterable<IPasteSelectionStreamEvent>> {
    await this.assertTableRecordWritable(tableId);
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext(container);

    const preparedPaste = await this.preparePasteCommandInput(tableId, pasteRo, options);
    const commandResult = PasteStreamCommand.create(preparedPaste.commandInput);
    if (commandResult.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(commandResult.error),
        mapDomainErrorToHttpStatus(commandResult.error)
      );
    }

    const result = await commandBus.execute<PasteStreamCommand, PasteStreamResult>(
      context,
      commandResult.value
    );
    if (result.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(result.error),
        mapDomainErrorToHttpStatus(result.error)
      );
    }

    return this.wrapStreamAndClearPreference(result.value, tableId);
  }

  async pasteByIdStream(
    tableId: string,
    pasteRo: IPasteByIdStreamRo,
    options?: {
      updateFilter?: IFilterSet | null;
      windowId?: string;
      allowFieldExpansion?: boolean;
      allowRecordExpansion?: boolean;
    }
  ): Promise<AsyncIterable<IPasteSelectionStreamEvent>> {
    await this.assertTableRecordWritable(tableId);
    const fieldIds = this.resolveSelectedFieldIds(pasteRo.selection);
    const recordIds = this.resolveSelectedRecordIds(pasteRo.selection);
    const syntheticPasteRo: IPasteRo = {
      ...pasteRo,
      projection: fieldIds ?? pasteRo.projection,
      ranges: [
        [0, 0],
        [Math.max((fieldIds?.length ?? 1) - 1, 0), Math.max((recordIds?.length ?? 1) - 1, 0)],
      ],
    };
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext(container);

    const preparedPaste = await this.preparePasteCommandInput(tableId, syntheticPasteRo, options);
    const commandResult = PasteStreamCommand.create({
      ...preparedPaste.commandInput,
      targetRecordIds: recordIds,
      excludedTargetRecordIds: this.resolveExcludedRecordIds(pasteRo.selection),
      targetFieldIds: fieldIds,
    });
    if (commandResult.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(commandResult.error),
        mapDomainErrorToHttpStatus(commandResult.error)
      );
    }

    const result = await commandBus.execute<PasteStreamCommand, PasteStreamResult>(
      context,
      commandResult.value
    );
    if (result.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(result.error),
        mapDomainErrorToHttpStatus(result.error)
      );
    }

    return this.wrapStreamAndClearPreference(result.value, tableId);
  }

  private resolveSelectedRecordIds(selection: ISelectionIdsRo['selection']): string[] | undefined {
    if (selection.allRecords) {
      return [];
    }
    const excluded = new Set(selection.excludedRecordIds ?? []);
    return selection.recordIds?.filter((recordId) => !excluded.has(recordId));
  }

  private resolveExcludedRecordIds(selection: ISelectionIdsRo['selection']): string[] | undefined {
    if (!selection.allRecords) {
      return undefined;
    }
    return selection.excludedRecordIds?.length ? selection.excludedRecordIds : undefined;
  }

  private resolveSelectedFieldIds(selection: ISelectionIdsRo['selection']): string[] | undefined {
    if (selection.allFields) {
      return undefined;
    }
    const excluded = new Set(selection.excludedFieldIds ?? []);
    return selection.fieldIds?.filter((fieldId) => !excluded.has(fieldId));
  }

  private async preparePasteCommandInput(
    tableId: string,
    pasteRo: IPasteRo,
    options?: {
      updateFilter?: IFilterSet | null;
      allowFieldExpansion?: boolean;
      allowRecordExpansion?: boolean;
    }
  ): Promise<{
    commandInput: IPasteCommandInput;
    finalContent: unknown[][];
    startCol: number;
    startRow: number;
    truncatedRows: number;
    type: IPasteRo['type'];
    ranges: IPasteRo['ranges'];
  }> {
    const tracer = trace.getTracer('default');
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

    return tracer.startActiveSpan('teable.paste.v2.prepare', async (span) => {
      try {
        let parsedContent: unknown[][] =
          typeof content === 'string' ? this.parseCopyContent(content) : content;

        const permissions = this.cls.get('permissions') ?? [];
        const hasFieldCreatePermission =
          options?.allowFieldExpansion ?? permissions.includes('field|create');
        const hasRecordCreatePermission =
          options?.allowRecordExpansion ?? permissions.includes('record|create');

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
        const container = await this.v2ContainerService.getContainerForTable(tableId);
        const context = await this.v2ContextFactory.createContext(container);
        const table = await this.loadV2Table(context, container, tableId);
        const queryBus = container.resolve<IQueryBus>(v2CoreTokens.queryBus);
        const queryScope = await this.prepareRecordQueryScope(context, container, table, {
          kind: RecordQueryOperationKind.list,
          viewId: rangeQuery.viewId,
          ignoreViewQuery: rangeQuery.ignoreViewQuery,
        });
        const orderedFieldIds = table.getOrderedVisibleFieldIds(rangeQuery.viewId, {
          projection,
        });
        const orderedIds = (
          orderedFieldIds.isOk() ? orderedFieldIds.value : table.fieldIds()
        ).filter(
          (fieldId) =>
            queryScope?.readableFieldIds == null ||
            queryScope.readableFieldIds.has(fieldId.toString())
        );
        const fields = orderedIds.flatMap((fieldId) => {
          const field = table.getField((candidate) => candidate.id().equals(fieldId));
          if (field.isErr()) {
            return [];
          }
          const dto = mapFieldToDto(field.value, table.primaryFieldId());
          if (dto.isErr()) {
            return [];
          }
          return [createFieldInstanceByVo(dto.value as IFieldVo)];
        });
        const fieldCount = fields.length;
        const countQuery = CountTableRecordsQuery.create(
          {
            tableId,
            viewId: rangeQuery.viewId,
            ignoreViewQuery: rangeQuery.ignoreViewQuery,
            filter: this.normalizeFilterForV2FromTable(table, queryRo.filter) ?? undefined,
            search: queryRo.search,
            projection: queryRo.projection,
            fieldKeyType: FieldKeyType.Id,
          },
          { table, queryScope }
        );
        if (countQuery.isErr()) {
          throwV2Error(
            mapDomainErrorToHttpError(countQuery.error),
            mapDomainErrorToHttpStatus(countQuery.error)
          );
        }
        const countResult = await queryBus.execute<CountTableRecordsQuery, CountTableRecordsResult>(
          context,
          countQuery.value
        );
        if (countResult.isErr()) {
          throwV2Error(
            mapDomainErrorToHttpError(countResult.error),
            mapDomainErrorToHttpStatus(countResult.error)
          );
        }
        const tableSize: [number, number] = [fieldCount, countResult.value.count];

        let startCol = 0;
        let startRow = 0;
        if (type === 'columns') {
          startCol = ranges[0]![0];
        } else if (type === 'rows') {
          startRow = ranges[0]![0];
        } else {
          startCol = ranges[0]![0];
          startRow = ranges[0]![1];
        }

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
        const numColsToExpand = Math.max(0, startCol + contentCols - tableSize[0]);
        const numRowsToExpand = Math.max(0, startRow + contentRows - tableSize[1]);
        const effectiveColsToExpand = hasFieldCreatePermission ? numColsToExpand : 0;
        const effectiveRowsToExpand = hasRecordCreatePermission ? numRowsToExpand : 0;
        const maxCols = tableSize[0] - startCol + effectiveColsToExpand;
        const maxRows = tableSize[1] - startRow + effectiveRowsToExpand;

        let truncatedCols = contentCols;
        let truncatedRows = contentRows;
        let finalContent = parsedContent;

        if (contentCols > maxCols || contentRows > maxRows) {
          truncatedRows = Math.min(contentRows, maxRows);
          truncatedCols = Math.min(contentCols, maxCols);
          finalContent = parsedContent
            .slice(0, truncatedRows)
            .map((row) => row.slice(0, truncatedCols));
        }

        let adjustedRanges = ranges;
        if (type === undefined && finalContent.length > 0 && finalContent[0]?.length > 0) {
          adjustedRanges = [
            [startCol, startRow],
            [startCol + truncatedCols - 1, startRow + truncatedRows - 1],
          ];
        }

        const targetFields = fields.slice(startCol, startCol + truncatedCols);
        const sourceFieldInstances = header?.map((field) => createFieldInstanceByVo(field));
        if (sourceFieldInstances) {
          finalContent = this.convertPasteContentWithSourceFields(
            finalContent,
            targetFields,
            sourceFieldInstances
          );
        }

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

        return {
          commandInput: {
            tableId,
            viewId: rangeQuery.viewId,
            ranges: adjustedRanges,
            content: finalContent,
            typecast: true,
            sourceFields,
            type,
            projection: projection?.length
              ? projection
              : orderedIds.map((fieldId) => fieldId.toString()),
            filter: normalizedFilter,
            search: rangeQuery.search,
            updateFilter: normalizedUpdateFilter,
            sort: sortWithGroupFallback,
            groupBy: rangeQuery.groupBy?.map((item) => ({
              fieldId: item.fieldId,
              order: item.order,
            })),
            ignoreViewQuery: rangeQuery.ignoreViewQuery,
          },
          finalContent,
          startCol,
          startRow,
          truncatedRows,
          type,
          ranges,
        };
      } finally {
        span.end();
      }
    });
  }

  private getFirstCopiedDateValue(sourceField: IFieldInstance, cellValue: unknown) {
    if (Array.isArray(cellValue)) {
      return cellValue[0];
    }

    if (typeof cellValue !== 'string' || !sourceField.isMultipleCellValue) {
      return cellValue;
    }

    const segments = cellValue
      .split(',')
      .map((segment) => segment.trim())
      .filter(Boolean);

    if (segments.length <= 1) {
      return cellValue;
    }

    const parserField = createFieldInstanceByVo({
      ...(pick(
        sourceField,
        'id',
        'dbFieldName',
        'name',
        'type',
        'description',
        'options',
        'meta',
        'aiConfig',
        'notNull',
        'unique',
        'isPrimary',
        'isPending',
        'hasError',
        'cellValueType',
        'dbFieldType'
      ) as IFieldVo),
      isComputed: false,
      isLookup: false,
      isConditionalLookup: false,
      isMultipleCellValue: false,
    });

    let candidate = '';
    for (const segment of segments) {
      candidate = candidate ? `${candidate}, ${segment}` : segment;
      const parsed = parserField.convertStringToCellValue(candidate);
      if (parsed != null) {
        return parsed;
      }
    }

    return segments[0];
  }

  private convertPasteCellValue(
    targetField: IFieldInstance,
    sourceField: IFieldInstance,
    cellValue: unknown
  ) {
    if (cellValue == null) {
      return null;
    }

    switch (targetField.type) {
      case FieldType.User:
      case FieldType.Attachment: {
        const cellValues = [cellValue].flat();
        return sourceField.type === targetField.type
          ? targetField.isMultipleCellValue
            ? cellValues
            : cellValues[0]
          : sourceField.cellValue2String(cellValue);
      }
      case FieldType.Date:
        return sourceField.type === FieldType.Date
          ? this.getFirstCopiedDateValue(sourceField, cellValue)
          : sourceField.cellValue2String(cellValue);
      case FieldType.Link:
        return convertLinkPasteCellValue(targetField, sourceField, cellValue);
      default:
        return sourceField.cellValue2String(cellValue) ?? null;
    }
  }

  private convertPasteContentWithSourceFields(
    tableData: unknown[][],
    targetFields: IFieldInstance[],
    sourceFields: IFieldInstance[]
  ) {
    return tableData.map((row) =>
      row.map((cellValue, col) => {
        const targetField = targetFields[col];
        const sourceField = sourceFields[col];
        if (!targetField || !sourceField || targetField.isComputed) {
          return cellValue;
        }
        return this.convertPasteCellValue(targetField, sourceField, cellValue);
      })
    );
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
    await this.assertTableRecordWritable(tableId);
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext(container);

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
      throwV2Error(result.body.error, result.status);
    }

    throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  async clearStream(
    tableId: string,
    rangesRo: IRangesRo
  ): Promise<AsyncIterable<IClearSelectionStreamEvent>> {
    await this.assertTableRecordWritable(tableId);
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext(container);

    const rangeQuery = await this.normalizeRangeQuery(tableId, rangesRo);
    const normalizedFilter = await this.normalizeFilterForV2(tableId, rangeQuery.filter);
    const sortWithGroupFallback = this.mergeGroupByIntoSort(rangeQuery.groupBy, rangeQuery.orderBy);

    const commandResult = ClearStreamCommand.create({
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
    });
    if (commandResult.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(commandResult.error),
        mapDomainErrorToHttpStatus(commandResult.error)
      );
    }

    const result = await commandBus.execute<ClearStreamCommand, ClearStreamResult>(
      context,
      commandResult.value
    );
    if (result.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(result.error),
        mapDomainErrorToHttpStatus(result.error)
      );
    }

    return this.wrapStreamAndClearPreference(result.value, tableId);
  }

  async clearByIdStream(
    tableId: string,
    selectionRo: ISelectionIdsRo
  ): Promise<AsyncIterable<IClearSelectionStreamEvent>> {
    await this.assertTableRecordWritable(tableId);
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext(container);
    const rangeQuery = await this.normalizeRangeQuery(tableId, selectionRo);
    const normalizedFilter = await this.normalizeFilterForV2(tableId, rangeQuery.filter);
    const sortWithGroupFallback = this.mergeGroupByIntoSort(rangeQuery.groupBy, rangeQuery.orderBy);

    const commandResult = ClearStreamCommand.create({
      tableId,
      viewId: rangeQuery.viewId,
      ranges: [
        [0, 0],
        [0, 0],
      ],
      projection: selectionRo.projection,
      filter: normalizedFilter,
      search: rangeQuery.search,
      sort: sortWithGroupFallback,
      groupBy: rangeQuery.groupBy?.map((item) => ({
        fieldId: item.fieldId,
        order: item.order,
      })),
      ignoreViewQuery: rangeQuery.ignoreViewQuery,
      targetRecordIds: selectionRo.selection.allRecords
        ? []
        : this.resolveSelectedRecordIds(selectionRo.selection),
      excludedTargetRecordIds: this.resolveExcludedRecordIds(selectionRo.selection),
      targetFieldIds: this.resolveSelectedFieldIds(selectionRo.selection),
    });
    if (commandResult.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(commandResult.error),
        mapDomainErrorToHttpStatus(commandResult.error)
      );
    }

    const result = await commandBus.execute<ClearStreamCommand, ClearStreamResult>(
      context,
      commandResult.value
    );
    if (result.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(result.error),
        mapDomainErrorToHttpStatus(result.error)
      );
    }

    return this.wrapStreamAndClearPreference(result.value, tableId);
  }

  /**
   * Get record IDs from ranges for undo/redo support and permission checks.
   * This method queries the record IDs that will be affected by a range-based operation.
   */
  async getRecordIdsFromRanges(tableId: string, rangesRo: IRangesRo): Promise<string[]> {
    const recordIds = await this.resolveRecordIdsBySelection(tableId, {
      ...rangesRo,
      selection: {},
    });

    if (rangesRo.type === RangeType.Columns) {
      return recordIds;
    }

    if (rangesRo.type === RangeType.Rows) {
      return rangesRo.ranges.flatMap(([start, end]) => recordIds.slice(start, end + 1));
    }

    const [start, end] = rangesRo.ranges;
    return recordIds.slice(start[1], end[1] + 1);
  }

  async deleteByRange(
    tableId: string,
    rangesRo: IRangesRo,
    windowId?: string
  ): Promise<{ ids: string[] }> {
    const recordIds = await this.getRecordIdsFromRanges(tableId, rangesRo);
    if (recordIds.length === 0) {
      return { ids: [] };
    }
    const deletedRecordIds = await this.deleteRecordsByIds(tableId, recordIds, windowId);
    return { ids: deletedRecordIds };
  }

  async deleteByRangeStream(
    tableId: string,
    rangesRo: IRangesRo
  ): Promise<AsyncIterable<IDeleteSelectionStreamEvent>> {
    await this.assertTableRecordWritable(tableId);
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext(container);
    const rangeQuery = await this.normalizeRangeQuery(tableId, rangesRo);
    const sortWithGroupFallback = this.mergeGroupByIntoSort(rangeQuery.groupBy, rangeQuery.orderBy);
    const recordIds = await this.getRecordIdsFromRanges(tableId, rangesRo);

    const commandResult = DeleteByRangeStreamCommand.create({
      tableId,
      viewId: rangeQuery.viewId,
      ranges: [
        [0, 0],
        [0, 0],
      ],
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
      targetRecordIds: recordIds,
    });
    if (commandResult.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(commandResult.error),
        mapDomainErrorToHttpStatus(commandResult.error)
      );
    }

    const result = await commandBus.execute<DeleteByRangeStreamCommand, DeleteByRangeStreamResult>(
      context,
      commandResult.value
    );
    if (result.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(result.error),
        mapDomainErrorToHttpStatus(result.error)
      );
    }

    return this.wrapStreamAndClearPreference(result.value, tableId);
  }

  async deleteByIdStream(
    tableId: string,
    selectionRo: ISelectionIdsRo
  ): Promise<AsyncIterable<IDeleteSelectionStreamEvent>> {
    await this.assertTableRecordWritable(tableId);
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext(container);
    const rangeQuery = await this.normalizeRangeQuery(tableId, selectionRo);
    const sortWithGroupFallback = this.mergeGroupByIntoSort(rangeQuery.groupBy, rangeQuery.orderBy);

    const commandResult = DeleteByRangeStreamCommand.create({
      tableId,
      viewId: rangeQuery.viewId,
      ranges: [
        [0, 0],
        [0, 0],
      ],
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
      targetRecordIds: this.resolveSelectedRecordIds(selectionRo.selection),
      excludedTargetRecordIds: this.resolveExcludedRecordIds(selectionRo.selection),
    });
    if (commandResult.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(commandResult.error),
        mapDomainErrorToHttpStatus(commandResult.error)
      );
    }

    const result = await commandBus.execute<DeleteByRangeStreamCommand, DeleteByRangeStreamResult>(
      context,
      commandResult.value
    );
    if (result.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(result.error),
        mapDomainErrorToHttpStatus(result.error)
      );
    }

    return this.wrapStreamAndClearPreference(result.value, tableId);
  }

  async duplicateByRangeStream(
    tableId: string,
    rangesRo: IRangesRo
  ): Promise<AsyncIterable<IDuplicateSelectionStreamEvent>> {
    await this.assertTableRecordWritable(tableId);
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext(container);

    const rangeQuery = await this.normalizeRangeQuery(tableId, rangesRo);
    const sortWithGroupFallback = this.mergeGroupByIntoSort(rangeQuery.groupBy, rangeQuery.orderBy);

    const commandResult = DuplicateRecordsStreamCommand.create({
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
    });
    if (commandResult.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(commandResult.error),
        mapDomainErrorToHttpStatus(commandResult.error)
      );
    }

    const result = await commandBus.execute<
      DuplicateRecordsStreamCommand,
      DuplicateRecordsStreamResult
    >(context, commandResult.value);
    if (result.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(result.error),
        mapDomainErrorToHttpStatus(result.error)
      );
    }

    return this.wrapStreamAndClearPreference(result.value, tableId);
  }

  async deleteRecords(
    tableId: string,
    recordIds: string[],
    _windowId?: string
  ): Promise<IRecordsVo> {
    await this.assertTableRecordWritable(tableId);
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const queryBus = container.resolve<IQueryBus>(v2CoreTokens.queryBus);
    const context = await this.v2ContextFactory.createContext(container);

    const recordsBeforeDelete: IRecord[] = [];
    for (let index = 0; index < recordIds.length; index += 1000) {
      const selectedRecordIds = recordIds.slice(index, index + 1000);
      const page = await this.executeListRecordsEndpoint(
        {
          tableId,
          fieldKeyType: FieldKeyType.Id,
          selectedRecordIds,
          limit: selectedRecordIds.length,
          ignoreViewQuery: true,
        },
        context,
        queryBus
      );
      recordsBeforeDelete.push(...(page.records as IRecord[]));
    }

    await this.executeDeleteRecordsCommand(context, commandBus, tableId, recordIds);

    // Return records that were deleted (V1 format)
    return {
      records: recordsBeforeDelete,
    };
  }

  // Returns the ids the engine actually deleted: unlike v1, the v2 delete reports
  // records that no longer exist as a successful zero/partial delete instead of
  // throwing, so callers that must know what happened have to check this list.
  async deleteRecordsByIds(
    tableId: string,
    recordIds: string[],
    _windowId?: string
  ): Promise<string[]> {
    await this.assertTableRecordWritable(tableId);
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext(container);

    return this.executeDeleteRecordsCommand(context, commandBus, tableId, recordIds);
  }

  // Archives records on the v2 engine: snapshot persist + physical delete in one
  // transaction. Returns the ids actually archived — records a concurrent delete
  // already removed report as a successful zero/partial archive, like the delete.
  async archiveRecordsByIds(
    tableId: string,
    recordIds: string[],
    options?: IArchiveRecordsCommandOptions
  ): Promise<string[]> {
    await this.assertTableRecordWritable(tableId);
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext(container);

    const result = await executeArchiveRecordsEndpoint(
      context,
      { tableId, recordIds },
      commandBus,
      options
    );

    if (result.status === 200 && result.body.ok) {
      await this.clearUndoRedoEnginePreference(tableId);
      return result.body.data.archivedRecordIds;
    }

    if (!result.body.ok) {
      throwV2Error(result.body.error, result.status);
    }

    throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  private async executeDeleteRecordsCommand(
    context: IExecutionContext,
    commandBus: ICommandBus,
    tableId: string,
    recordIds: string[]
  ): Promise<string[]> {
    const result = await executeDeleteRecordsEndpoint(context, { tableId, recordIds }, commandBus);

    if (result.status === 200 && result.body.ok) {
      await this.clearUndoRedoEnginePreference(tableId);
      return result.body.data.deletedRecordIds;
    }

    if (!result.body.ok) {
      throwV2Error(result.body.error, result.status);
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
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const context = await this.v2ContextFactory.createContext(container);
    const table = await this.loadV2Table(context, container, tableId);
    const defaultView = table.defaultView();
    if (defaultView.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(defaultView.error),
        mapDomainErrorToHttpStatus(defaultView.error)
      );
    }
    return defaultView.value.id().toString();
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

    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const context = await this.v2ContextFactory.createContext(container);
    const table = await this.loadV2Table(context, container, tableId);
    const queryScope = await this.prepareRecordQueryScope(context, container, table, {
      kind: RecordQueryOperationKind.list,
      viewId: query.viewId,
      ignoreViewQuery: query.ignoreViewQuery,
    });
    const { result, appliedGroupBy } = await this.getRecordsWithPreparedScope(
      tableId,
      {
        viewId: query.viewId,
        ignoreViewQuery: query.ignoreViewQuery,
        filter: query.filter,
        search: this.normalizeGroupRelatedSearch(query.search),
        groupBy: normalizedGroupBy,
        take: 1,
        skip: 0,
        fieldKeyType: FieldKeyType.Id,
        includeQueryExtra: true,
      },
      queryScope,
      container,
      context,
      table
    );
    const collapsedFilter = this.buildCollapsedGroupFilter(
      table,
      appliedGroupBy,
      result.extra?.groupPoints,
      query.collapsedGroupIds
    );
    if (!collapsedFilter) {
      return query.filter;
    }
    if (!query.filter) {
      return collapsedFilter as unknown as IFilter;
    }
    return {
      conjunction: 'and',
      filterSet: [query.filter as IFilterSet, collapsedFilter as unknown as IFilterSet],
    };
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

  /**
   * Pure-path filter normalize: field meta from table aggregate (no FieldService).
   * Always rewrites field keys to field **ids** so ListTableRecords (fieldKeyType=id)
   * can apply filters that clients send as names.
   */
  private normalizeFilterForV2FromTable(
    table: Table,
    filter: unknown
  ): RecordFilter | undefined | null {
    const fieldMetaMap = this.buildFilterFieldMetaFromTable(table);
    const mapped = this.mapV1FilterToV2(filter);
    if (!mapped) {
      return mapped;
    }
    const withIds = this.rewriteFilterFieldKeysToIds(table, mapped);
    if (!withIds) {
      return undefined;
    }
    return this.normalizeFilterForV2WithFieldMeta(filter, fieldMetaMap, withIds);
  }

  /**
   * Rewrite filter condition fieldId (and field-reference values) from name/dbName
   * to field ids. List query always uses fieldKeyType=id.
   */
  private rewriteFilterFieldKeysToIds(table: Table, filter: RecordFilter): RecordFilter | null {
    const byId = new Map(table.getFields().map((field) => [field.id().toString(), field]));
    const byName = new Map(
      table.getFields().map((field) => [field.name().toString(), field.id().toString()])
    );
    const byDbName = new Map<string, string>();
    for (const field of table.getFields()) {
      const dbResult = field.dbFieldName();
      if (dbResult.isOk()) {
        const valueResult = dbResult.value.value();
        if (valueResult.isOk() && valueResult.value) {
          byDbName.set(valueResult.value, field.id().toString());
        }
      }
    }

    const resolveKey = (key: string): string | undefined => {
      if (byId.has(key)) return key;
      return byName.get(key) ?? byDbName.get(key);
    };

    const rewriteNode = (node: RecordFilterNode): RecordFilterNode | null => {
      if ('not' in node) {
        const next = rewriteNode(node.not);
        return next ? { not: next } : null;
      }
      if ('items' in node) {
        const items = node.items
          .map((item) => rewriteNode(item))
          .filter((item): item is RecordFilterNode => Boolean(item));
        if (!items.length) return null;
        return { conjunction: node.conjunction, items };
      }
      const fieldId = resolveKey(node.fieldId);
      if (!fieldId) {
        return null;
      }
      let value = node.value;
      if (
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        (value as { type?: string }).type === 'field' &&
        typeof (value as { fieldId?: unknown }).fieldId === 'string'
      ) {
        const refId = resolveKey((value as { fieldId: string }).fieldId);
        if (!refId) {
          return null;
        }
        value = { ...(value as object), fieldId: refId } as typeof value;
      }
      return { ...node, fieldId, value };
    };

    if (filter == null) {
      return null;
    }
    return rewriteNode(filter);
  }

  /**
   * Write-path filter normalize: load the Table aggregate instead of FieldService.
   */
  private async normalizeFilterForV2(
    tableId: string,
    filter: unknown
  ): Promise<RecordFilter | undefined | null> {
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const context = await this.v2ContextFactory.createContext(container);
    const table = await this.loadV2Table(context, container, tableId);
    return this.normalizeFilterForV2FromTable(table, filter);
  }

  private buildFilterFieldMetaFromTable(table: Table): Map<string, FilterFieldMeta> {
    const fieldMetaMap = new Map<string, FilterFieldMeta>();
    for (const field of table.getFields()) {
      const presentationField = this.presentationField(field);
      const type = presentationField.type().toString() as FieldType;
      const valueTypeResult = field.accept(new FieldValueTypeVisitor());
      const optionsResult = presentationField.accept(new FieldOptionsDtoVisitor());
      const options =
        optionsResult.isOk() && optionsResult.value && typeof optionsResult.value === 'object'
          ? (optionsResult.value as FilterFieldMeta['options'])
          : undefined;
      const meta: FilterFieldMeta = {
        type,
        cellValueType: valueTypeResult.isOk()
          ? this.cellValueTypeFromV2ValueType(valueTypeResult.value.cellValueType.toString())
          : this.cellValueTypeFromV2FieldType(type),
        options,
      };
      fieldMetaMap.set(field.id().toString(), meta);
      fieldMetaMap.set(field.name().toString(), meta);
    }
    return fieldMetaMap;
  }

  private cellValueTypeFromV2ValueType(type: string): CellValueType {
    switch (type) {
      case 'boolean':
        return CellValueType.Boolean;
      case 'number':
        return CellValueType.Number;
      case 'dateTime':
        return CellValueType.DateTime;
      default:
        return CellValueType.String;
    }
  }

  private cellValueTypeFromV2FieldType(type: string): CellValueType {
    switch (type) {
      case 'checkbox':
        return CellValueType.Boolean;
      case 'number':
      case 'rating':
      case 'autoNumber':
        return CellValueType.Number;
      case 'date':
      case 'createdTime':
      case 'lastModifiedTime':
        return CellValueType.DateTime;
      default:
        return CellValueType.String;
    }
  }

  private normalizeFilterForV2WithFieldMeta(
    filter: unknown,
    fieldMetaMap: Map<string, FilterFieldMeta>,
    preMapped?: RecordFilter | null
  ): RecordFilter | undefined | null {
    const mapped = preMapped !== undefined ? preMapped : this.mapV1FilterToV2(filter);
    if (!mapped) {
      return mapped;
    }

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
          // V1 drops incomplete non-checkbox filters such as `field is <empty input>`.
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

      value = this.normalizeLegacyDateComparisonValue(fieldMeta, operator, value);

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

  private normalizeLegacyDateComparisonValue(
    fieldMeta: FilterFieldMeta | undefined,
    operator: RecordFilterOperator,
    value: RecordFilterValue
  ): RecordFilterValue {
    if (
      !fieldMeta ||
      !dateComparisonOperators.has(operator) ||
      !this.isDateFilterField(fieldMeta)
    ) {
      return value;
    }
    if (this.isRecordFilterFieldReferenceValue(value) || Array.isArray(value)) {
      return value;
    }
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
      return value;
    }

    return {
      mode: 'exactDate',
      exactDate: value,
      timeZone: this.extractDatetimeFormatting(fieldMeta.options)?.timeZone ?? 'utc',
    } as RecordFilterDateValue;
  }

  private isDateFilterField(fieldMeta: FilterFieldMeta): boolean {
    return (
      dateFilterFieldTypes.has(fieldMeta.type as FieldType) ||
      fieldMeta.cellValueType === CellValueType.DateTime
    );
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
      // Preserve is/isNot+null until field-aware normalization can distinguish
      // checkbox unchecked checks from incomplete non-checkbox UI filters.
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
      throwV2Error(
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
      throwV2Error(
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
    await this.assertTableRecordWritable(tableId);
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext(container);

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
      return result.body.data.record as IRecord;
    }

    if (!result.body.ok) {
      throwV2Error(result.body.error, result.status);
    }

    throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  async getRecordStatus(
    tableId: string,
    recordId: string,
    query: IGetRecordsRo
  ): Promise<IRecordStatusVo> {
    this.assertValidListQuery(query);

    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const context = await this.v2ContextFactory.createContext(container);
    const table = await this.loadV2Table(context, container, tableId);
    const queryScope = await this.prepareRecordQueryScope(context, container, table, {
      kind: RecordQueryOperationKind.list,
      viewId: query.viewId,
      ignoreViewQuery: query.ignoreViewQuery,
      limit: query.take,
      offset: query.skip,
      keepPrimaryKey: Boolean(query.filterLinkCellSelected),
    });
    const orderBy = this.resolveSortGroupFieldKeysToIds(table, query.orderBy ?? undefined);
    const groupBy = this.resolveSortGroupFieldKeysToIds(table, query.groupBy ?? undefined);
    const sortWithGroupFallback = this.mergeGroupByIntoSort(groupBy, orderBy);
    const queryResult = GetRecordStatusQuery.create(
      {
        tableId,
        recordId,
        viewId: query.viewId,
        ignoreViewQuery: query.ignoreViewQuery,
        filter: this.normalizeFilterForV2FromTable(table, query.filter) ?? undefined,
        sort: sortWithGroupFallback?.map((item) => ({
          fieldId: item.fieldId,
          order: item.order,
        })),
        groupBy: groupBy?.map((item) => item.fieldId),
        search: query.search,
        filterLinkCellSelected: query.filterLinkCellSelected,
        filterLinkCellCandidate: query.filterLinkCellCandidate,
        ...(query.selectedRecordIds?.length ? { selectedRecordIds: query.selectedRecordIds } : {}),
        limit: query.take,
        offset: query.skip,
        fieldKeyType: FieldKeyType.Id,
      },
      { queryScope, table }
    );
    if (queryResult.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(queryResult.error),
        mapDomainErrorToHttpStatus(queryResult.error)
      );
    }
    const queryBus = container.resolve<IQueryBus>(v2CoreTokens.queryBus);
    const result = await queryBus.execute<GetRecordStatusQuery, GetRecordStatusResult>(
      context,
      queryResult.value
    );
    if (result.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(result.error),
        mapDomainErrorToHttpStatus(result.error)
      );
    }
    return {
      isDeleted: result.value.isDeleted,
      isVisible: result.value.isVisible,
    };
  }

  async getCollaborators(
    tableId: string,
    query: IRecordGetCollaboratorsRo
  ): Promise<IRecordGetCollaboratorsVo> {
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const queryBus = container.resolve<IQueryBus>(v2CoreTokens.queryBus);
    const context = await this.v2ContextFactory.createContext(container);
    const table = await this.loadV2Table(context, container, tableId);
    const queryScope = await this.prepareRecordQueryScope(context, container, table, {
      kind: RecordQueryOperationKind.list,
      projectionFieldIds: [query.fieldId],
      limit: query.take,
      offset: query.skip,
    });
    const queryResult = GetRecordCollaboratorsQuery.create(
      {
        tableId,
        fieldId: query.fieldId,
        search: query.search,
        take: query.take,
        skip: query.skip,
      },
      { queryScope }
    );
    if (queryResult.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(queryResult.error),
        mapDomainErrorToHttpStatus(queryResult.error)
      );
    }
    const result = await queryBus.execute<
      GetRecordCollaboratorsQuery,
      GetRecordCollaboratorsResult
    >(context, queryResult.value);
    if (result.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(result.error),
        mapDomainErrorToHttpStatus(result.error)
      );
    }
    return [...result.value.collaborators];
  }

  assertCopyCellCount(recordCount: number, fieldCount: number): void {
    const cellCount = recordCount * fieldCount;
    if (cellCount <= this.thresholdConfig.maxCopyCells) {
      return;
    }
    throw new CustomHttpException(
      `Exceed max copy cells ${this.thresholdConfig.maxCopyCells}`,
      HttpErrorCode.VALIDATION_ERROR,
      {
        localization: {
          i18nKey: 'httpErrors.selection.exceedMaxCopyCells',
        },
      }
    );
  }

  async copy(tableId: string, copyRo: IRangesRo): Promise<ICopyVo> {
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const context = await this.v2ContextFactory.createContext(container);
    const table = await this.loadV2Table(context, container, tableId);
    const orderedReadableIds = await this.getOrderedReadableFieldIds(tableId, {
      viewId: copyRo.viewId,
      projection: copyRo.projection,
      ignoreViewQuery: copyRo.ignoreViewQuery,
    });
    const availableFields: V2Field[] = orderedReadableIds.flatMap((fieldId) => {
      const field = table.getField((candidate) => candidate.id().toString() === fieldId);
      return field.isOk() ? [field.value] : [];
    });
    let headerFields: ReadonlyArray<V2Field>;
    if (copyRo.type === RangeType.Columns) {
      headerFields = copyRo.ranges.flatMap(([start, end]) => availableFields.slice(start, end + 1));
    } else if (copyRo.type === RangeType.Rows) {
      headerFields = availableFields;
    } else {
      const [start, end] = copyRo.ranges;
      headerFields = availableFields.slice(start[0], end[0] + 1);
    }
    const header: IFieldVo[] = headerFields.map((field) => {
      const fieldDto = mapFieldToDto(field, table.primaryFieldId());
      if (fieldDto.isErr()) {
        throwV2Error(
          mapDomainErrorToHttpError(fieldDto.error),
          mapDomainErrorToHttpStatus(fieldDto.error)
        );
      }
      return fieldDto.value as IFieldVo;
    });
    const recordIds = await this.getRecordIdsFromRanges(tableId, copyRo);
    this.assertCopyCellCount(recordIds.length, header.length);
    const records = await this.getRecordsByIds(tableId, recordIds, {
      projection: header.map((field) => field.id),
      fieldKeyType: FieldKeyType.Id,
    });
    const rows = records.map((record) =>
      headerFields.map((field) => {
        const value = field.accept(
          new FieldClipboardValueVisitor(record.fields[field.id().toString()])
        );
        if (value.isErr()) {
          throwV2Error(
            mapDomainErrorToHttpError(value.error),
            mapDomainErrorToHttpStatus(value.error)
          );
        }
        return value.value;
      })
    );
    return { content: stringifyClipboardText(rows), header };
  }
}
