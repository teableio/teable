import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { FieldKeyResolverService } from '../application/services/FieldKeyResolverService';
import {
  mergeOrderBy,
  resolveGroupByToOrderBy,
  resolveOrderBy as resolveQueryOrderBy,
} from '../commands/shared/orderBy';
import { domainError, isNotFoundError, type DomainError } from '../domain/shared/DomainError';
import { composeAndSpecsOrUndefined } from '../domain/shared/specification/composeAndSpecs';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldKeyType } from '../domain/table/fields/FieldKeyType';
import type { RecordId } from '../domain/table/records/RecordId';
import type { ITableRecordConditionSpecVisitor } from '../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import { TableRecord } from '../domain/table/records/TableRecord';
import { TableByIdSpec } from '../domain/table/specs/TableByIdSpec';
import type { Table } from '../domain/table/Table';
import type { ViewQueryGroupItem } from '../domain/table/views/ViewQueryDefaults';
import { NoopTableQueryObservability } from '../ports/defaults/NoopTableQueryObservability';
import type { IExecutionContext } from '../ports/ExecutionContext';
import * as LoggerPort from '../ports/Logger';
import type { RecordQueryFieldMask } from '../ports/RecordQueryPlugin';
import { ITableQueryObservability } from '../ports/TableQueryObservability';
import type { TableQueryObservabilityEvent } from '../ports/TableQueryObservability';
import {
  createSearchTraceAttributes,
  createTableQueryTraceAttributes,
  type TableSearchAccessPath,
  type TableSearchMode,
  type TableSearchScope,
} from '../ports/TableQueryTraceAttributes';
import * as TableRecordQueryRepositoryPort from '../ports/TableRecordQueryRepository';
import type { ITableRecordGroup } from '../ports/TableRecordQueryRepository';
import type { TableRecordReadModel } from '../ports/TableRecordReadModel';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { ListTableRecordsQuery, type RecordSortValue } from './ListTableRecordsQuery';
import { QueryHandler, type IQueryHandler } from './QueryHandler';
import type { RecordFilter } from './RecordFilterDto';
import { replaceCurrentUserTagInFilter, sanitizeRecordFilter } from './RecordFilterMapper';
import { RecordSearch, resolveVisibleRowSearch } from './RecordSearch';
import {
  buildLinkCandidatePlan,
  buildTableRecordConditionPlan,
} from './tableRecordQueryConditionPlan';
import {
  filterFieldIdsByQueryAccess,
  getEnabledFieldIdSet,
  mergeFilterWithViewDefaults,
  resolveFilterFieldKeys,
  resolveProjectionFieldIds,
  sanitizeFilterByEnabledFieldIds,
} from './tableRecordQueryPlan';

export class ListTableRecordsResult {
  private constructor(
    readonly records: ReadonlyArray<TableRecordReadModel>,
    readonly total: number,
    readonly offset: number,
    readonly limit: number,
    readonly groups?: ReadonlyArray<ITableRecordGroup>,
    readonly searchMatches?: ReadonlyArray<TableRecordQueryRepositoryPort.ITableRecordSearchMatch>,
    readonly appliedGroup?: ReadonlyArray<ViewQueryGroupItem>
  ) {}

  static create(
    records: ReadonlyArray<TableRecordReadModel>,
    total: number,
    offset: number,
    limit: number,
    groups?: ReadonlyArray<ITableRecordGroup>,
    searchMatches?: ReadonlyArray<TableRecordQueryRepositoryPort.ITableRecordSearchMatch>,
    appliedGroup?: ReadonlyArray<ViewQueryGroupItem>
  ): ListTableRecordsResult {
    return new ListTableRecordsResult(
      records,
      total,
      offset,
      limit,
      groups,
      searchMatches,
      appliedGroup
    );
  }
}

/**
 * Collect field ids referenced by a condition specification tree
 * (left/right field of conditions + field-reference values).
 * Used so mask evaluation can load dependency columns that are not returned.
 */
const collectFieldIdsFromSpec = (spec: unknown): ReadonlySet<string> => {
  const ids = new Set<string>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') {
      return;
    }
    const candidate = node as {
      leftSpec?: () => unknown;
      rightSpec?: () => unknown;
      innerSpec?: () => unknown;
      field?: () => { id: () => { toString: () => string } };
      value?: () => unknown;
    };
    if (typeof candidate.leftSpec === 'function' && typeof candidate.rightSpec === 'function') {
      walk(candidate.leftSpec());
      walk(candidate.rightSpec());
      return;
    }
    if (typeof candidate.innerSpec === 'function') {
      walk(candidate.innerSpec());
      return;
    }
    if (typeof candidate.field === 'function') {
      try {
        ids.add(candidate.field().id().toString());
      } catch {
        // ignore non-field specs
      }
    }
    if (typeof candidate.value === 'function') {
      const value = candidate.value();
      if (
        value &&
        typeof value === 'object' &&
        typeof (value as { field?: unknown }).field === 'function'
      ) {
        try {
          ids.add(
            (value as { field: () => { id: () => { toString: () => string } } })
              .field()
              .id()
              .toString()
          );
        } catch {
          // ignore
        }
      }
    }
  };
  walk(spec);
  return ids;
};

const collectMaskDependencyFieldIds = (
  fieldMasks: ReadonlyArray<RecordQueryFieldMask> | undefined
): ReadonlySet<string> => {
  const ids = new Set<string>();
  for (const mask of fieldMasks ?? []) {
    for (const fieldId of collectFieldIdsFromSpec(mask.visibleWhen)) {
      ids.add(fieldId);
    }
  }
  return ids;
};

/**
 * Apply conditional field masks (visibleWhen) after read.
 * Fields that fail the mask are omitted from the result payload (null-out).
 *
 * Fail-closed: if a mask dependency field was not loaded into the evaluation
 * projection, the masked field is stripped (never fail-open on missing deps).
 */
const applyFieldMasksToRecords = (
  table: Table,
  records: ReadonlyArray<TableRecordReadModel>,
  fieldMasks: ReadonlyArray<RecordQueryFieldMask> | undefined,
  evaluationFieldIds?: ReadonlySet<string>
): ReadonlyArray<TableRecordReadModel> => {
  if (!fieldMasks?.length || !records.length) {
    return records;
  }

  const maskDepsByFieldId = new Map(
    fieldMasks.map((mask) => [mask.fieldId, collectFieldIdsFromSpec(mask.visibleWhen)] as const)
  );

  return records.map((record) => {
    const domainRecordResult = TableRecord.fromRawFieldValues({
      id: record.id,
      tableId: table.id(),
      fields: record.fields,
    });
    // Fail-closed: if we cannot evaluate masks, strip all masked fields.
    if (domainRecordResult.isErr()) {
      const nextFields = { ...record.fields };
      for (const mask of fieldMasks) {
        delete nextFields[mask.fieldId];
      }
      return { ...record, fields: nextFields };
    }
    const domainRecord = domainRecordResult.value;
    let changed = false;
    const nextFields = { ...record.fields };
    for (const mask of fieldMasks) {
      if (!Object.prototype.hasOwnProperty.call(nextFields, mask.fieldId)) {
        continue;
      }
      const deps = maskDepsByFieldId.get(mask.fieldId);
      // Fail-closed when a dependency was never loaded into the evaluation
      // projection. (isEmpty/isNot on undefined fail-open — do not evaluate.)
      // Null values that were projected still evaluate normally.
      const missingFromProjection =
        evaluationFieldIds != null &&
        deps != null &&
        [...deps].some((depId) => !evaluationFieldIds.has(depId));
      if (missingFromProjection) {
        delete nextFields[mask.fieldId];
        changed = true;
        continue;
      }
      if (!mask.visibleWhen.isSatisfiedBy(domainRecord)) {
        delete nextFields[mask.fieldId];
        changed = true;
      }
    }
    return changed ? { ...record, fields: nextFields } : record;
  });
};

/**
 * Search may keep conditionally masked fields in the row filter (otherwise
 * all-fields search compiles to SQL `false`). Search-index hits are
 * cell-level: drop matches whose field was stripped for that record, and in
 * matched mode reindex so rows that only hit hidden cells do not leave gaps.
 */
const filterSearchMatchesByVisibleCells = (
  searchMatches: ReadonlyArray<TableRecordQueryRepositoryPort.ITableRecordSearchMatch> | undefined,
  maskedRecords: ReadonlyArray<TableRecordReadModel>,
  fieldMasks: ReadonlyArray<RecordQueryFieldMask> | undefined,
  mode: 'matched' | 'view',
  offset: number
): ReadonlyArray<TableRecordQueryRepositoryPort.ITableRecordSearchMatch> | undefined => {
  if (!searchMatches?.length || !fieldMasks?.length) {
    return searchMatches;
  }
  const fieldsByRecordId = new Map(maskedRecords.map((record) => [record.id, record.fields]));
  const visibleMatches = searchMatches.filter((match) =>
    Object.prototype.hasOwnProperty.call(
      fieldsByRecordId.get(match.recordId.toString()) ?? {},
      match.fieldId.toString()
    )
  );
  if (mode !== 'matched' || visibleMatches.length === searchMatches.length) {
    return visibleMatches;
  }
  const indexByRecordId = new Map<string, number>();
  let nextIndex = offset + 1;
  return visibleMatches.map((match) => {
    const recordId = match.recordId.toString();
    let index = indexByRecordId.get(recordId);
    if (index == null) {
      index = nextIndex++;
      indexByRecordId.set(recordId, index);
    }
    return index === match.index ? match : { ...match, index };
  });
};

/** Response-hidden fields remain queryable when a visibility mask exists. */
const filterSortByQueryAccess = (
  sort: ReadonlyArray<RecordSortValue> | undefined,
  enabledFieldIds: ReadonlySet<string> | undefined,
  maskedFieldIds: ReadonlySet<string> | undefined
): ReadonlyArray<RecordSortValue> | undefined => {
  if (!sort?.length || enabledFieldIds == null) {
    return sort;
  }
  const filtered = sort.filter(
    (item) => enabledFieldIds.has(item.fieldId) || maskedFieldIds?.has(item.fieldId)
  );
  return filtered.length ? filtered : undefined;
};

const filterGroupByQueryAccess = (
  group: ReadonlyArray<ViewQueryGroupItem> | undefined,
  enabledFieldIds: ReadonlySet<string> | undefined,
  maskedFieldIds: ReadonlySet<string> | undefined
): ReadonlyArray<ViewQueryGroupItem> | undefined => {
  if (!group?.length || enabledFieldIds == null) {
    return group;
  }
  const filtered = group.filter(
    (item) => enabledFieldIds.has(item.fieldId) || maskedFieldIds?.has(item.fieldId)
  );
  return filtered.length ? filtered : undefined;
};

const rejectUnreadableSortOrGroup = (
  kind: 'sort' | 'group',
  items: ReadonlyArray<{ fieldId: string }> | undefined,
  enabledFieldIds: ReadonlySet<string> | undefined,
  maskedFieldIds: ReadonlySet<string> | undefined
): Result<void, DomainError> => {
  if (!items?.length || enabledFieldIds == null) {
    return ok(undefined);
  }
  if (
    !items.some((item) => !enabledFieldIds.has(item.fieldId) && !maskedFieldIds?.has(item.fieldId))
  ) {
    return ok(undefined);
  }
  return err(
    domainError.validation({
      code: `record.${kind}.unreadable_field`,
      message: `${kind === 'sort' ? 'Sort' : 'Group'} references a field that is not readable`,
    })
  );
};

const nowMs = () => Date.now();

const resolveSearchAccessPath = (
  query: ListTableRecordsQuery,
  visibleRowSearch: ReturnType<typeof resolveVisibleRowSearch>,
  resolution?: TableRecordQueryRepositoryPort.IRecordSearchAccessPathResolution
): {
  accessPath: TableSearchAccessPath;
  searchMode: TableSearchMode;
  searchScope: TableSearchScope;
  fallbackReason?: string;
  languageConfig?: string;
  generatedColumnName?: string;
  indexProvider?: 'pg_trgm' | 'pg_bigm';
} => {
  if (!visibleRowSearch) {
    return {
      accessPath: 'none',
      searchMode: 'none',
      searchScope: 'none',
      ...(query.recordSearchAccessPath?.kind === 'generated_tsvector' ||
      query.recordSearchAccessPath?.kind === 'generated_text'
        ? { fallbackReason: 'no_visible_row_search' }
        : {}),
    };
  }

  const searchScope = visibleRowSearch.search.searchesAllFields()
    ? 'all_fields'
    : 'selected_fields';
  if (query.recordSearchAccessPath?.kind === 'generated_text') {
    if (resolution?.used === 'default') {
      return {
        accessPath: 'fallback',
        searchMode: 'ilike',
        searchScope,
        fallbackReason: resolution.fallbackReason ?? 'generated_text_unavailable',
      };
    }
    if (resolution?.used !== 'generated_text') {
      return { accessPath: 'none', searchMode: 'none', searchScope };
    }
    return {
      accessPath:
        query.recordSearchAccessPath.provider === 'pg_bigm'
          ? 'generated_text_bigram'
          : 'generated_text_trigram',
      searchMode: 'substring',
      searchScope,
      generatedColumnName: query.recordSearchAccessPath.generatedColumnName,
      indexProvider: query.recordSearchAccessPath.provider,
    };
  }
  if (query.recordSearchAccessPath?.kind === 'generated_tsvector') {
    if (resolution?.used === 'default') {
      return {
        accessPath: 'fallback',
        searchMode: 'ilike',
        searchScope,
        fallbackReason: resolution.fallbackReason ?? 'generated_tsvector_unavailable',
      };
    }
    if (resolution?.used !== 'generated_tsvector') {
      return { accessPath: 'none', searchMode: 'none', searchScope };
    }
    return {
      accessPath: 'generated_tsvector',
      searchMode: 'full_text',
      searchScope,
      languageConfig: query.recordSearchAccessPath.languageConfig,
      generatedColumnName: query.recordSearchAccessPath.generatedColumnName,
    };
  }

  return {
    accessPath: 'default_ilike',
    searchMode: 'ilike',
    searchScope,
  };
};

const createListRecordsObservabilityEvent = (
  query: ListTableRecordsQuery,
  input?: {
    readonly hasFilter?: boolean;
    readonly hasSort?: boolean;
    readonly hasGroup?: boolean;
    readonly visibleRowSearch?: ReturnType<typeof resolveVisibleRowSearch>;
    readonly searchAccessPath?: TableRecordQueryRepositoryPort.IRecordSearchAccessPathResolution;
    readonly resultCount?: number;
    readonly errorKind?: string;
    readonly durationMs?: number;
  }
): TableQueryObservabilityEvent => {
  const visibleRowSearch = input?.visibleRowSearch;
  const searchPath = resolveSearchAccessPath(query, visibleRowSearch, input?.searchAccessPath);

  return {
    tableId: query.tableId.toString(),
    viewId: query.viewId,
    queryKind: visibleRowSearch ? 'search' : 'record_list',
    querySource: 'v2.list_records',
    hasFilter: input?.hasFilter ?? Boolean(query.filter),
    hasSort: input?.hasSort ?? Boolean(query.sort?.length),
    hasGroup: input?.hasGroup ?? Boolean(query.groupBy?.length),
    includeTotal: query.includeTotal !== false,
    searchValue: visibleRowSearch?.search.value,
    fieldCount: visibleRowSearch?.visibleFieldIds?.length,
    allFields: visibleRowSearch?.search.searchesAllFields(),
    accessPath: searchPath.accessPath,
    searchMode: searchPath.searchMode,
    searchScope: searchPath.searchScope,
    languageConfig: searchPath.languageConfig,
    fallbackReason: searchPath.fallbackReason,
    generatedColumnName: searchPath.generatedColumnName,
    indexProvider: searchPath.indexProvider,
    resultCount: input?.resultCount,
    errorKind: input?.errorKind,
    durationMs: input?.durationMs,
  };
};

type ListRecordsQueryPlan = {
  readonly spec?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>;
  readonly recordIdsOrder?: ReadonlyArray<RecordId>;
};

const resolveSortValues = (
  table: Table,
  sort: ReadonlyArray<RecordSortValue> | undefined,
  fieldKeyType: FieldKeyType,
  enabledFieldIds?: ReadonlySet<string>
): Result<ReadonlyArray<RecordSortValue> | undefined, DomainError> => {
  const resolvedSort: RecordSortValue[] = [];
  const seen = new Set<string>();

  for (const item of sort ?? []) {
    const resolvedFieldId = FieldKeyResolverService.resolveFieldKey(
      table,
      item.fieldId,
      fieldKeyType
    );
    if (resolvedFieldId.isErr()) {
      return err(resolvedFieldId.error);
    }

    const fieldId = FieldId.create(resolvedFieldId.value);
    if (fieldId.isErr()) {
      return err(fieldId.error);
    }

    const normalizedFieldId = fieldId.value.toString();
    if (enabledFieldIds && !enabledFieldIds.has(normalizedFieldId)) {
      continue;
    }

    const key = `field:${normalizedFieldId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    resolvedSort.push({
      fieldId: normalizedFieldId,
      order: item.order,
    });
  }

  return ok(resolvedSort.length ? resolvedSort : undefined);
};

const mergeSortWithViewDefaults = (
  defaultSort: ReadonlyArray<RecordSortValue> | undefined,
  manualSort: boolean | undefined,
  querySort: ReadonlyArray<RecordSortValue> | undefined
): ReadonlyArray<RecordSortValue> | undefined => {
  if (!defaultSort && !querySort) {
    return undefined;
  }

  if (manualSort && !querySort?.length) {
    return [];
  }

  if (!defaultSort?.length) {
    return querySort ? [...querySort] : undefined;
  }

  if (!querySort?.length) {
    return [...defaultSort];
  }

  const map = new Map(querySort.map((item) => [item.fieldId, item]));
  defaultSort.forEach((item) => {
    if (!map.has(item.fieldId)) {
      map.set(item.fieldId, item);
    }
  });
  return Array.from(map.values());
};

@QueryHandler(ListTableRecordsQuery)
@injectable()
export class ListTableRecordsHandler
  implements IQueryHandler<ListTableRecordsQuery, ListTableRecordsResult>
{
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.tableRecordQueryRepository)
    private readonly tableRecordQueryRepository: TableRecordQueryRepositoryPort.ITableRecordQueryRepository,
    @inject(v2CoreTokens.logger)
    private readonly logger: LoggerPort.ILogger,
    @inject(v2CoreTokens.tableQueryObservability)
    private readonly tableQueryObservability: ITableQueryObservability = new NoopTableQueryObservability()
  ) {}

  async handle(
    context: IExecutionContext,
    query: ListTableRecordsQuery
  ): Promise<Result<ListTableRecordsResult, DomainError>> {
    const logger = this.logger.scope('query', { name: ListTableRecordsHandler.name }).child({
      tableId: query.tableId.toString(),
    });
    logger.debug('ListTableRecordsHandler.start', { actorId: context.actorId.toString() });

    const startedAt = nowMs();
    let observabilityEvent = createListRecordsObservabilityEvent(query);
    const span = context.tracer?.startSpan('teable.table.query.list_records', {
      ...createTableQueryTraceAttributes(observabilityEvent),
      ...createSearchTraceAttributes(observabilityEvent),
    });

    try {
      const result = await safeTry<ListTableRecordsResult, DomainError>(
        async function* (this: ListTableRecordsHandler) {
          // 1. Load main table (tableId is globally unique). A trusted host may
          // preload the aggregate; only reuse it when it matches the queried id.
          const preloadedTable =
            query.table && query.table.id().equals(query.tableId) ? query.table : undefined;
          const loadTableSpan = preloadedTable
            ? undefined
            : context.tracer?.startSpan('teable.ListTableRecordsHandler.loadTable');
          const table =
            preloadedTable ??
            (yield* (
              await this.tableRepository.findOne(context, TableByIdSpec.create(query.tableId))
            ).mapErr((error: DomainError) =>
              isNotFoundError(error)
                ? domainError.notFound({ code: 'table.not_found', message: 'Table not found' })
                : error
            ));
          loadTableSpan?.end();

          // 2. Resolve effective filter/sort/search inputs with view defaults and permission-aware fields.
          const enabledFieldIds = getEnabledFieldIdSet(query);
          let effectiveFilter: RecordFilter | undefined;
          let effectiveSort: ReadonlyArray<RecordSortValue> | undefined;
          let effectiveGroup: ReadonlyArray<ViewQueryGroupItem> | undefined;
          let orderBy: ReturnType<typeof mergeOrderBy> | undefined;
          let queryPlan: ListRecordsQueryPlan | undefined;
          let projectionFieldIds: ReadonlyArray<FieldId> | undefined;
          const resolveShapeSpan = context.tracer?.startSpan('teable.table.query.resolve_shape', {
            ...createTableQueryTraceAttributes(observabilityEvent),
            ...createSearchTraceAttributes(observabilityEvent),
          });
          try {
            const resolvedFilter = query.filter
              ? yield* resolveFilterFieldKeys(table, query.filter, query.fieldKeyType)
              : undefined;
            const actorResolvedFilter = replaceCurrentUserTagInFilter(
              table,
              resolvedFilter,
              context.actorId.toString()
            );

            const conditionPlanDeps = {
              tableRepository: this.tableRepository,
              tableRecordQueryRepository: this.tableRecordQueryRepository,
              logger: this.logger,
            };
            // Pre-resolve link candidate plan so filterByViewId can inform effectiveView.
            const linkCandidatePlan = query.filterLinkCellCandidate
              ? yield* await buildLinkCandidatePlan(
                  conditionPlanDeps,
                  context,
                  table,
                  query.filterLinkCellCandidate
                )
              : undefined;

            // query.viewId takes priority; fall back to the link field's filterByViewId.
            let effectiveView =
              query.viewId && !query.ignoreViewQuery
                ? yield* table.getViewById(query.viewId)
                : undefined;
            if (!effectiveView && linkCandidatePlan?.filterByViewId && !query.ignoreViewQuery) {
              const fallbackViewResult = table.getViewById(linkCandidatePlan.filterByViewId);
              if (fallbackViewResult.isOk()) {
                effectiveView = fallbackViewResult.value;
              }
              // silently ignore if the view no longer exists
            }
            const resolvedSort = yield* resolveSortValues(table, query.sort, query.fieldKeyType);
            const effectiveQueryDefaults = effectiveView
              ? yield* effectiveView.queryDefaults()
              : undefined;
            // Grid subscriptions inline the persisted view filter/sort and set
            // ignoreViewQuery so skip-poll can observe every dependency. Keep a
            // read-only copy of those defaults to distinguish an exact view echo
            // from extra client conditions without applying the defaults twice.
            let referencedViewQueryDefaults: typeof effectiveQueryDefaults;
            if (query.viewId && query.ignoreViewQuery) {
              const referencedViewResult = table.getViewById(query.viewId);
              if (referencedViewResult.isOk()) {
                referencedViewQueryDefaults = yield* referencedViewResult.value.queryDefaults();
              }
            }
            const defaultFilter = replaceCurrentUserTagInFilter(
              table,
              effectiveQueryDefaults?.filter(),
              context.actorId.toString()
            );
            const sanitizedDefaultFilter = yield* sanitizeRecordFilter(table, defaultFilter);
            // Plain-value filters use the three-valued mask rewrite. Field
            // references stay fail-closed until both sides support mask SQL;
            // sort/group/search use masked SQL expressions below (T6997).
            const maskedFieldIds = query.queryScope?.fieldMasks?.length
              ? new Set(query.queryScope.fieldMasks.map((mask) => mask.fieldId))
              : undefined;
            const permissionSanitizedDefaultFilter = yield* sanitizeFilterByEnabledFieldIds(
              sanitizedDefaultFilter,
              enabledFieldIds,
              maskedFieldIds,
              'strip'
            );
            const permissionValidatedClientFilter = yield* sanitizeFilterByEnabledFieldIds(
              actorResolvedFilter,
              enabledFieldIds,
              maskedFieldIds,
              query.searchIndexMode != null ? 'strip' : 'reject'
            );
            effectiveFilter = mergeFilterWithViewDefaults(
              permissionSanitizedDefaultFilter,
              permissionValidatedClientFilter
            );
            // Resolve groupBy to field IDs before query-access validation;
            // raw keys may be name/dbFieldName.
            const resolvedGroupFieldIds: string[] = [];
            for (const groupKey of query.groupBy ?? []) {
              const groupFieldId = yield* FieldKeyResolverService.resolveFieldKey(
                table,
                groupKey,
                query.fieldKeyType
              );
              resolvedGroupFieldIds.push(groupFieldId);
            }
            const clientGroupFieldIds = new Set(resolvedGroupFieldIds);
            // Grid clients echo view.group as groupBy. Treat those keys as
            // view-owned so stale fields with neither projection nor a mask
            // can degrade without 400ing the record query.
            const viewOwnedGroupFieldIds = new Set(
              effectiveQueryDefaults?.group()?.map((item) => item.fieldId) ?? []
            );
            const extraGroupItems = resolvedGroupFieldIds
              .filter((fieldId) => !viewOwnedGroupFieldIds.has(fieldId))
              .map((fieldId) => ({ fieldId }));
            // Group first so pure groupBy is not mislabeled as sort (OpenAPI
            // merges groupBy into sort before calling list).
            yield* rejectUnreadableSortOrGroup(
              'group',
              extraGroupItems,
              enabledFieldIds,
              maskedFieldIds
            );
            // Sort-only keys: exclude groupBy fields that were folded into sort.
            const clientSortOnly = resolvedSort?.filter(
              (item) => !clientGroupFieldIds.has(item.fieldId)
            );
            const referencedViewSort = referencedViewQueryDefaults?.sort();
            const isExactReferencedViewSortEcho =
              referencedViewSort != null &&
              clientSortOnly != null &&
              referencedViewSort.length === clientSortOnly.length &&
              referencedViewSort.every(
                (viewItem, index) =>
                  viewItem.fieldId === clientSortOnly[index]?.fieldId &&
                  viewItem.order === clientSortOnly[index]?.order
              );
            // Only the complete persisted-view sort echo is server-owned.
            // Masked fields are valid query dependencies; only fields with
            // neither projection access nor a mask remain unavailable.
            const extraSortItems = isExactReferencedViewSortEcho ? undefined : clientSortOnly;
            yield* rejectUnreadableSortOrGroup(
              'sort',
              extraSortItems,
              enabledFieldIds,
              maskedFieldIds
            );
            const isUnavailableField = (fieldId: string) =>
              enabledFieldIds != null &&
              !enabledFieldIds.has(fieldId) &&
              !maskedFieldIds?.has(fieldId);
            const skippedEchoedGroupFieldIds = new Set(
              resolvedGroupFieldIds.filter(
                (fieldId) => viewOwnedGroupFieldIds.has(fieldId) && isUnavailableField(fieldId)
              )
            );
            const sortWithoutSkippedViewItems = resolvedSort?.filter(
              (item) =>
                !skippedEchoedGroupFieldIds.has(item.fieldId) &&
                !(isExactReferencedViewSortEcho && isUnavailableField(item.fieldId))
            );
            // View-default masked fields remain active and query the masked
            // value domain. Truly unavailable stale fields are filtered below.
            const viewDefaultSort = mergeSortWithViewDefaults(
              effectiveQueryDefaults?.sort(),
              effectiveQueryDefaults?.manualSort(),
              undefined
            );
            effectiveSort = filterSortByQueryAccess(
              mergeSortWithViewDefaults(viewDefaultSort, undefined, sortWithoutSkippedViewItems),
              enabledFieldIds,
              maskedFieldIds
            );
            effectiveGroup = filterGroupByQueryAccess(
              query.groupBy?.length
                ? resolvedGroupFieldIds.map((fieldId) => ({
                    fieldId,
                    order:
                      resolvedSort?.find((item) => item.fieldId === fieldId)?.order ??
                      ('asc' as const),
                  }))
                : effectiveQueryDefaults?.group(),
              enabledFieldIds,
              maskedFieldIds
            );
            orderBy = mergeOrderBy(
              yield* resolveGroupByToOrderBy(effectiveGroup),
              yield* resolveQueryOrderBy(effectiveSort),
              query.viewId
            );
            const builtQueryPlan = yield* await buildTableRecordConditionPlan(
              conditionPlanDeps,
              context,
              table,
              {
                filterLinkCellSelected: query.filterLinkCellSelected,
                filterLinkCellCandidate: query.filterLinkCellCandidate,
                selectedRecordIds: query.selectedRecordIds,
                fieldMasks: query.queryScope?.fieldMasks,
              },
              effectiveFilter,
              linkCandidatePlan
            );
            // AND pure-V2 permission row scope into the condition tree
            // (unless link-selected keepPrimary / skipRecordSpec).
            const rowScopeSpec =
              query.queryScope?.skipRecordSpec || !query.queryScope?.recordSpec
                ? undefined
                : query.queryScope.recordSpec;
            queryPlan = {
              ...builtQueryPlan,
              spec: composeAndSpecsOrUndefined(
                [builtQueryPlan.spec, rowScopeSpec].filter(
                  (spec): spec is ISpecification<TableRecord, ITableRecordConditionSpecVisitor> =>
                    spec != null
                )
              ),
            };
            projectionFieldIds = yield* resolveProjectionFieldIds(
              table,
              query.projection,
              query.fieldKeyType,
              enabledFieldIds
            );
            // Expand projection with static readable fields + mask dependency
            // fields so visibleWhen evaluation is not fail-open on missing columns.
            // Visible-scope search matches also need the mask target cell so
            // hidden hits can be removed after masking. Internal fields are
            // never returned — they are stripped after mask apply.
            if (query.queryScope?.fieldMasks?.length) {
              const maskDeps = collectMaskDependencyFieldIds(query.queryScope.fieldMasks);
              const searchMatchMaskTargets =
                query.includeSearchFieldMatches && query.searchFieldScope === 'visible'
                  ? query.queryScope.fieldMasks.map((mask) => mask.fieldId)
                  : [];
              // No projection + no allow-list means "all columns" — seed with
              // every table field so expansion cannot collapse to mask deps.
              const baseFieldIds =
                projectionFieldIds == null && enabledFieldIds == null
                  ? table.fieldIds().map((id) => id.toString())
                  : [
                      ...(projectionFieldIds?.map((id) => id.toString()) ?? []),
                      ...(enabledFieldIds ?? []),
                    ];
              const expanded = new Set([...baseFieldIds, ...maskDeps, ...searchMatchMaskTargets]);
              const expandedIds: FieldId[] = [];
              for (const fieldIdText of expanded) {
                const fieldId = FieldId.create(fieldIdText);
                if (fieldId.isOk()) {
                  expandedIds.push(fieldId.value);
                }
              }
              projectionFieldIds = expandedIds;
            }
            observabilityEvent = createListRecordsObservabilityEvent(query, {
              hasFilter: Boolean(effectiveFilter),
              hasSort: Boolean(effectiveSort?.length),
              hasGroup: Boolean(effectiveGroup?.length),
            });
            span?.setAttributes({
              ...createTableQueryTraceAttributes(observabilityEvent),
              ...createSearchTraceAttributes(observabilityEvent),
            });
            resolveShapeSpan?.setAttributes({
              ...createTableQueryTraceAttributes(observabilityEvent),
              ...createSearchTraceAttributes(observabilityEvent),
            });
          } finally {
            resolveShapeSpan?.end();
          }

          // 3. Resolve visible-row search through the repository. Response-
          // hidden fields remain searchable when a mask exists; the adapter
          // ANDs every field predicate with visibleWhen, matching v1's
          // permission-CTE value domain (T6997).
          const searchMaskedFieldIds = query.queryScope?.fieldMasks?.length
            ? new Set(query.queryScope.fieldMasks.map((mask) => mask.fieldId))
            : undefined;
          const requestedSearch = RecordSearch.fromOptionalTuple(query.search);
          // Explicit targets remain not-found only when a field has neither
          // projection access nor a visibility mask.
          if (requestedSearch && !requestedSearch.searchesAllFields()) {
            for (const key of requestedSearch.fieldKeys() ?? []) {
              const resolved = RecordSearch.resolveFieldKey(table, key);
              if (resolved.isErr()) {
                continue;
              }
              const fieldId = resolved.value.id().toString();
              if (
                query.requireReadableSearchFields &&
                enabledFieldIds != null &&
                !enabledFieldIds.has(fieldId) &&
                !searchMaskedFieldIds?.has(fieldId)
              ) {
                yield* err(
                  domainError.notFound({
                    code: 'record.search.field_not_found',
                    message: `Search field not found: ${key}`,
                  })
                );
              }
            }
          }
          const orderedSearchFieldIds =
            query.viewId && !query.ignoreViewQuery
              ? yield* table.getOrderedVisibleFieldIds(query.viewId)
              : table.fieldIds();
          const searchVisibleFieldIds = filterFieldIdsByQueryAccess(
            orderedSearchFieldIds,
            enabledFieldIds,
            searchMaskedFieldIds
          );
          // searchFieldScope 'visible' keeps the full visible-field row scope:
          // the record-list path wants search to filter rows across everything
          // the user can see, with match columns as a side channel. The default
          // 'projection' narrowing serves the search-index API, where rows
          // exist only to carry hits in the projected columns.
          const projectedSearchVisibleFieldIds =
            query.includeSearchFieldMatches &&
            projectionFieldIds &&
            query.searchFieldScope !== 'visible'
              ? searchVisibleFieldIds.filter((fieldId) =>
                  projectionFieldIds.some((projectedFieldId) => projectedFieldId.equals(fieldId))
                )
              : searchVisibleFieldIds;
          const visibleRowSearch = resolveVisibleRowSearch(
            requestedSearch,
            projectedSearchVisibleFieldIds
          );
          const searchFieldMatchesSearch =
            query.includeSearchFieldMatches && requestedSearch?.value.length
              ? {
                  search: requestedSearch,
                  visibleFieldIds: projectedSearchVisibleFieldIds,
                }
              : undefined;
          const searchAccessEvent = createListRecordsObservabilityEvent(query, {
            hasFilter: Boolean(effectiveFilter),
            hasSort: Boolean(effectiveSort?.length),
            hasGroup: Boolean(effectiveGroup?.length),
            visibleRowSearch,
          });
          observabilityEvent = searchAccessEvent;

          // 4. Query records with pagination
          const queryRecordsSpan = context.tracer?.startSpan('teable.table.query.records.find', {
            ...createTableQueryTraceAttributes(searchAccessEvent),
            ...createSearchTraceAttributes(searchAccessEvent),
          });
          let queryRecordsResult: Result<
            TableRecordQueryRepositoryPort.ITableRecordQueryResult,
            DomainError
          >;
          try {
            queryRecordsResult = await this.tableRecordQueryRepository.find(
              context,
              table,
              queryPlan?.spec,
              {
                pagination: query.pagination,
                orderBy: queryPlan?.recordIdsOrder?.length ? undefined : orderBy,
                recordIdsOrder: queryPlan?.recordIdsOrder,
                search: visibleRowSearch,
                searchFieldMatchesSearch,
                // !!!IMPORTANT: List table records are always using stored values
                // never change this to 'computed'
                mode: 'stored',
                projectionFieldIds,
                includeTotal: query.includeTotal,
                recordReadQuerySource: query.recordReadQuerySource,
                searchAccessPath: query.recordSearchAccessPath,
                includeSearchFieldMatches: query.includeSearchFieldMatches,
                searchIndexMode: query.searchIndexMode,
                fieldMasks: query.queryScope?.fieldMasks,
                idsOnly: query.idsOnly,
                ...(query.includeGroupMetadata && effectiveGroup?.length
                  ? {
                      groupBy: ((yield* resolveGroupByToOrderBy(effectiveGroup!)) ?? []).filter(
                        TableRecordQueryRepositoryPort.isFieldOrderBy
                      ),
                      groupLimit: query.groupLimit,
                    }
                  : {}),
              }
            );
            if (queryRecordsResult.isOk()) {
              const appliedSearchEvent = createListRecordsObservabilityEvent(query, {
                hasFilter: Boolean(effectiveFilter),
                hasSort: Boolean(effectiveSort?.length),
                hasGroup: Boolean(effectiveGroup?.length),
                visibleRowSearch,
                searchAccessPath: queryRecordsResult.value.searchAccessPath,
              });
              queryRecordsSpan?.setAttributes({
                ...createTableQueryTraceAttributes(appliedSearchEvent),
                ...createSearchTraceAttributes(appliedSearchEvent),
              });
            }
          } finally {
            queryRecordsSpan?.end();
          }
          const queryResult = yield* queryRecordsResult;

          // 5. Apply field masks, strip to requested projection, then remap keys
          const requestedProjection =
            query.projection === undefined
              ? undefined
              : new Set(
                  (yield* resolveProjectionFieldIds(
                    table,
                    query.projection,
                    query.fieldKeyType,
                    enabledFieldIds
                  ))?.map((id) => id.toString()) ?? []
                );
          // Field ids available for mask evaluation (readable + deps). Used for
          // fail-closed checks when a dependency was not projected.
          const evaluationFieldIds = projectionFieldIds
            ? new Set(projectionFieldIds.map((id) => id.toString()))
            : enabledFieldIds
              ? new Set(enabledFieldIds)
              : undefined;
          let maskedRecords = applyFieldMasksToRecords(
            table,
            queryResult.records,
            query.queryScope?.fieldMasks,
            evaluationFieldIds
          );
          const searchMatches = filterSearchMatchesByVisibleCells(
            queryResult.searchMatches,
            maskedRecords,
            query.queryScope?.fieldMasks,
            query.searchIndexMode ?? 'matched',
            query.pagination.offset().toNumber()
          );
          // Strip mask dependency fields that were only loaded for evaluation.
          if (requestedProjection) {
            maskedRecords = maskedRecords.map((record) => {
              const nextFields: Record<string, unknown> = {};
              for (const [fieldId, value] of Object.entries(record.fields)) {
                if (requestedProjection.has(fieldId)) {
                  nextFields[fieldId] = value;
                }
              }
              return { ...record, fields: nextFields };
            });
          } else if (enabledFieldIds != null) {
            // No explicit client projection: return only allow-listed fields
            // (never leak internal mask dependency columns).
            maskedRecords = maskedRecords.map((record) => {
              const nextFields: Record<string, unknown> = {};
              for (const [fieldId, value] of Object.entries(record.fields)) {
                if (enabledFieldIds.has(fieldId)) {
                  nextFields[fieldId] = value;
                }
              }
              return { ...record, fields: nextFields };
            });
          }
          const transformedRecords =
            query.fieldKeyType !== FieldKeyType.Id
              ? maskedRecords.map((record) => ({
                  ...record,
                  fields: FieldKeyResolverService.transformResponseKeys(
                    table,
                    record.fields,
                    query.fieldKeyType
                  ),
                }))
              : maskedRecords;

          logger.debug('ListTableRecordsHandler.success', {
            count: queryResult.records.length,
            total: queryResult.total,
          });
          observabilityEvent = createListRecordsObservabilityEvent(query, {
            hasFilter: Boolean(effectiveFilter),
            hasSort: Boolean(effectiveSort?.length),
            hasGroup: Boolean(effectiveGroup?.length),
            visibleRowSearch,
            resultCount: queryResult.records.length,
            searchAccessPath: queryResult.searchAccessPath,
          });
          const searchAccessPathSpan = context.tracer?.startSpan(
            'teable.table.search.resolve_access_path',
            {
              ...createTableQueryTraceAttributes(observabilityEvent),
              ...createSearchTraceAttributes(observabilityEvent),
            }
          );
          searchAccessPathSpan?.end();
          if (observabilityEvent.fallbackReason) {
            this.tableQueryObservability.recordSearchFallback(observabilityEvent);
          }

          return ok(
            ListTableRecordsResult.create(
              transformedRecords,
              queryResult.total,
              query.pagination.offset().toNumber(),
              query.pagination.limit().toNumber(),
              queryResult.groups,
              searchMatches,
              effectiveGroup?.length ? effectiveGroup : undefined
            )
          );
        }.bind(this)
      );

      if (result.isErr()) {
        const errorKind = result.error.code ?? 'domain_error';
        observabilityEvent = { ...observabilityEvent, errorKind };
        span?.recordError(result.error.message ?? errorKind);
        this.tableQueryObservability.recordError(observabilityEvent);
      }

      return result;
    } catch (error) {
      const errorKind = error instanceof Error ? error.name : 'unknown_error';
      observabilityEvent = { ...observabilityEvent, errorKind };
      span?.recordError(error instanceof Error ? error.message : String(error));
      this.tableQueryObservability.recordError(observabilityEvent);
      throw error;
    } finally {
      const durationMs = nowMs() - startedAt;
      this.tableQueryObservability.recordRequest({
        ...observabilityEvent,
        durationMs,
      });
      span?.setAttributes({
        ...createTableQueryTraceAttributes(observabilityEvent),
        ...createSearchTraceAttributes(observabilityEvent),
      });
      span?.end();
    }
  }
}
