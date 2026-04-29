import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { FieldKeyResolverService } from '../application/services/FieldKeyResolverService';
import { mergeOrderBy, resolveOrderBy as resolveQueryOrderBy } from '../commands/shared/orderBy';
import { domainError, isNotFoundError, type DomainError } from '../domain/shared/DomainError';
import { type ISpecification } from '../domain/shared/specification/ISpecification';
import { FieldType } from '../domain/table/fields/FieldType';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldKeyType } from '../domain/table/fields/FieldKeyType';
import { FieldCondition } from '../domain/table/fields/types/FieldCondition';
import type { LinkField } from '../domain/table/fields/types/LinkField';
import { RecordId } from '../domain/table/records/RecordId';
import { IncomingLinkCandidateSpec } from '../domain/table/records/specs/IncomingLinkCandidateSpec';
import { IncomingLinkSelectedSpec } from '../domain/table/records/specs/IncomingLinkSelectedSpec';
import type { ITableRecordConditionSpecVisitor } from '../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import { RecordByIdsSpec } from '../domain/table/records/specs/RecordByIdsSpec';
import { RecordConditionSpecBuilder } from '../domain/table/records/specs/RecordConditionSpecBuilder';
import type { TableRecord } from '../domain/table/records/TableRecord';
import { TableByIdSpec } from '../domain/table/specs/TableByIdSpec';
import { TableByIncomingReferenceToTableSpec } from '../domain/table/specs/TableByIncomingReferenceToTableSpec';
import type { Table } from '../domain/table/Table';
import type { IExecutionContext } from '../ports/ExecutionContext';
import * as LoggerPort from '../ports/Logger';
import * as TableRecordQueryRepositoryPort from '../ports/TableRecordQueryRepository';
import type { TableRecordReadModel } from '../ports/TableRecordReadModel';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { ListTableRecordsQuery, type RecordSortValue } from './ListTableRecordsQuery';
import { QueryHandler, type IQueryHandler } from './QueryHandler';
import {
  isRecordFilterCondition,
  isRecordFilterFieldReferenceValue,
  isRecordFilterGroup,
  isRecordFilterNot,
  type RecordFilter,
  type RecordFilterCondition,
  type RecordFilterNode,
  type RecordFilterValue,
} from './RecordFilterDto';
import { buildRecordConditionSpec, sanitizeRecordFilter } from './RecordFilterMapper';
import { RecordSearch, resolveVisibleRowSearch } from './RecordSearch';

const currentUserFilterValue = 'Me';

export class ListTableRecordsResult {
  private constructor(
    readonly records: ReadonlyArray<TableRecordReadModel>,
    readonly total: number,
    readonly offset: number,
    readonly limit: number
  ) {}

  static create(
    records: ReadonlyArray<TableRecordReadModel>,
    total: number,
    offset: number,
    limit: number
  ): ListTableRecordsResult {
    return new ListTableRecordsResult(records, total, offset, limit);
  }
}

/**
 * Resolve field keys in filter to field IDs
 * Recursively walks the filter tree and resolves fieldId keys
 */
function resolveFilterFieldKeys(
  table: Table,
  filter: RecordFilter,
  fieldKeyType: FieldKeyType
): Result<RecordFilter, DomainError> {
  if (!filter) {
    return ok(null);
  }

  return resolveFilterNodeFieldKeys(table, filter, fieldKeyType);
}

function resolveFilterNodeFieldKeys(
  table: Table,
  node: RecordFilterNode,
  fieldKeyType: FieldKeyType
): Result<RecordFilterNode, DomainError> {
  // If already using field IDs, no resolution needed
  if (fieldKeyType === FieldKeyType.Id) {
    return ok(node);
  }

  if (isRecordFilterCondition(node)) {
    // Resolve the condition's fieldId
    const fieldIdResult = FieldKeyResolverService.resolveFieldKey(
      table,
      node.fieldId,
      fieldKeyType
    );
    if (fieldIdResult.isErr()) {
      return err(fieldIdResult.error);
    }

    const resolvedCondition: RecordFilterCondition = {
      ...node,
      fieldId: fieldIdResult.value,
    };

    // Also resolve field reference in value if present
    if (
      node.value &&
      typeof node.value === 'object' &&
      isRecordFilterFieldReferenceValue(node.value)
    ) {
      const valueFieldIdResult = FieldKeyResolverService.resolveFieldKey(
        table,
        node.value.fieldId,
        fieldKeyType
      );
      if (valueFieldIdResult.isErr()) {
        return err(valueFieldIdResult.error);
      }

      return ok({
        ...resolvedCondition,
        value: {
          ...node.value,
          fieldId: valueFieldIdResult.value,
        },
      });
    }

    return ok(resolvedCondition);
  }

  if (isRecordFilterGroup(node)) {
    // Resolve all items in the group
    const resolvedItems: RecordFilterNode[] = [];
    for (const item of node.items) {
      const resolved = resolveFilterNodeFieldKeys(table, item, fieldKeyType);
      if (resolved.isErr()) {
        return resolved;
      }
      resolvedItems.push(resolved.value);
    }

    return ok({
      conjunction: node.conjunction,
      items: resolvedItems,
    });
  }

  if (isRecordFilterNot(node)) {
    // Resolve the not node
    return resolveFilterNodeFieldKeys(table, node.not, fieldKeyType).map((resolvedNot) => ({
      not: resolvedNot,
    }));
  }

  return ok(node);
}

function isUserLikeFieldType(type: FieldType): boolean {
  return (
    type.equals(FieldType.user()) ||
    type.equals(FieldType.createdBy()) ||
    type.equals(FieldType.lastModifiedBy())
  );
}

function replaceCurrentUserTagInFilter(
  table: Table,
  filter: RecordFilter | null | undefined,
  actorId: string
): RecordFilter | null | undefined {
  if (!filter) {
    return filter;
  }

  const replaceNode = (node: RecordFilterNode): RecordFilterNode => {
    if (isRecordFilterNot(node)) {
      return { not: replaceNode(node.not) };
    }

    if (isRecordFilterGroup(node)) {
      return {
        ...node,
        items: node.items.map((item) => replaceNode(item)),
      };
    }

    if (!isRecordFilterCondition(node)) {
      return node;
    }

    const fieldResult = table.getField((field) => field.id().toString() === node.fieldId);
    if (fieldResult.isErr() || !isUserLikeFieldType(fieldResult.value.type())) {
      return node;
    }

    const replaceValue = (value: RecordFilterValue): RecordFilterValue => {
      if (Array.isArray(value)) {
        return value.map((item) => (item === currentUserFilterValue ? actorId : item));
      }
      return value === currentUserFilterValue ? actorId : value;
    };

    return {
      ...node,
      value: replaceValue(node.value),
    };
  };

  return replaceNode(filter);
}

type IRecordReadQuerySource = {
  enabledFieldIds?: ReadonlyArray<string>;
};

type IExecutionContextWithRecordReadQuerySource = IExecutionContext & {
  recordReadQuerySource?: IRecordReadQuerySource;
};

const getEnabledFieldIdSet = (context: IExecutionContext): ReadonlySet<string> | undefined => {
  const enabledFieldIds = (context as IExecutionContextWithRecordReadQuerySource)
    .recordReadQuerySource?.enabledFieldIds;
  return enabledFieldIds ? new Set(enabledFieldIds) : undefined;
};

const sanitizeFilterByEnabledFieldIds = (
  filter: RecordFilter | undefined,
  enabledFieldIds: ReadonlySet<string> | undefined
): RecordFilter | undefined => {
  if (!filter || enabledFieldIds == null) {
    return filter;
  }

  const sanitizeNode = (node: RecordFilterNode): RecordFilterNode | undefined => {
    if (isRecordFilterCondition(node)) {
      return enabledFieldIds.has(node.fieldId) ? node : undefined;
    }

    if (isRecordFilterGroup(node)) {
      const items = node.items
        .map((item) => sanitizeNode(item))
        .filter((item): item is RecordFilterNode => item != null);

      return items.length
        ? {
            conjunction: node.conjunction,
            items,
          }
        : undefined;
    }

    if (isRecordFilterNot(node)) {
      const nextNode = sanitizeNode(node.not);
      return nextNode ? { not: nextNode } : undefined;
    }

    return node;
  };

  return sanitizeNode(filter);
};

const mergeFilterWithViewDefaults = (
  defaultFilter: RecordFilter | null | undefined,
  queryFilter: RecordFilter | undefined
): RecordFilter | undefined => {
  if (!defaultFilter && !queryFilter) {
    return undefined;
  }

  if (queryFilter) {
    return defaultFilter
      ? {
          conjunction: 'and',
          items: [defaultFilter, queryFilter],
        }
      : queryFilter;
  }

  return defaultFilter ?? undefined;
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

const filterFieldIdsByEnabledFieldIds = (
  fieldIds: ReadonlyArray<FieldId>,
  enabledFieldIds: ReadonlySet<string> | undefined
): ReadonlyArray<FieldId> => {
  if (enabledFieldIds == null) {
    return fieldIds;
  }

  return fieldIds.filter((fieldId) => enabledFieldIds.has(fieldId.toString()));
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
    private readonly logger: LoggerPort.ILogger
  ) {}

  async handle(
    context: IExecutionContext,
    query: ListTableRecordsQuery
  ): Promise<Result<ListTableRecordsResult, DomainError>> {
    const logger = this.logger.scope('query', { name: ListTableRecordsHandler.name }).child({
      tableId: query.tableId.toString(),
    });
    logger.debug('ListTableRecordsHandler.start', { actorId: context.actorId.toString() });

    // Start main span for the query handler
    const span = context.tracer?.startSpan('teable.ListTableRecordsHandler.handle');

    try {
      return safeTry<ListTableRecordsResult, DomainError>(
        async function* (this: ListTableRecordsHandler) {
          // 1. Load main table (tableId is globally unique)
          const loadTableSpan = context.tracer?.startSpan(
            'teable.ListTableRecordsHandler.loadTable'
          );
          const tableSpec = TableByIdSpec.create(query.tableId);
          const table = yield* (await this.tableRepository.findOne(context, tableSpec)).mapErr(
            (error: DomainError) =>
              isNotFoundError(error)
                ? domainError.notFound({ code: 'table.not_found', message: 'Table not found' })
                : error
          );
          loadTableSpan?.end();

          // 2. Resolve effective filter/sort/search inputs with view defaults and permission-aware fields.
          const enabledFieldIds = getEnabledFieldIdSet(context);
          const resolvedFilter = query.filter
            ? yield* resolveFilterFieldKeys(table, query.filter, query.fieldKeyType)
            : undefined;
          const actorResolvedFilter = replaceCurrentUserTagInFilter(
            table,
            resolvedFilter,
            context.actorId.toString()
          );

          // Pre-resolve link candidate plan so filterByViewId can inform effectiveView.
          const linkCandidatePlan = query.filterLinkCellCandidate
            ? yield* await this.buildLinkCandidatePlan(
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
          const resolvedSort = yield* resolveSortValues(
            table,
            query.sort,
            query.fieldKeyType,
            enabledFieldIds
          );
          const effectiveQueryDefaults = effectiveView
            ? yield* effectiveView.queryDefaults()
            : undefined;
          const defaultFilter = replaceCurrentUserTagInFilter(
            table,
            effectiveQueryDefaults?.filter(),
            context.actorId.toString()
          );
          const sanitizedDefaultFilter = yield* sanitizeRecordFilter(table, defaultFilter);
          const effectiveFilter = sanitizeFilterByEnabledFieldIds(
            mergeFilterWithViewDefaults(sanitizedDefaultFilter, actorResolvedFilter),
            enabledFieldIds
          );
          const effectiveSort = mergeSortWithViewDefaults(
            effectiveQueryDefaults?.sort(),
            effectiveQueryDefaults?.manualSort(),
            resolvedSort
          );
          const orderBy = mergeOrderBy(
            undefined,
            yield* resolveQueryOrderBy(effectiveSort),
            query.viewId
          );
          const queryPlan = yield* await this.buildQueryPlan(
            context,
            table,
            query,
            effectiveFilter,
            linkCandidatePlan
          );

          // 3. Resolve visible-row search through the repository
          const searchVisibleFieldIds =
            query.viewId && !query.ignoreViewQuery
              ? filterFieldIdsByEnabledFieldIds(
                  yield* table.getOrderedVisibleFieldIds(query.viewId),
                  enabledFieldIds
                )
              : filterFieldIdsByEnabledFieldIds(table.fieldIds(), enabledFieldIds);
          const visibleRowSearch = resolveVisibleRowSearch(
            RecordSearch.fromOptionalTuple(query.search),
            searchVisibleFieldIds
          );

          // 4. Query records with pagination
          const queryRecordsSpan = context.tracer?.startSpan(
            'teable.ListTableRecordsHandler.queryRecords'
          );
          const queryResult = yield* await this.tableRecordQueryRepository.find(
            context,
            table,
            queryPlan.spec,
            {
              pagination: query.pagination,
              orderBy: queryPlan.recordIdsOrder?.length ? undefined : orderBy,
              recordIdsOrder: queryPlan.recordIdsOrder,
              search: visibleRowSearch,
              // !!!IMPORTANT: List table records are always using stored values
              // never change this to 'computed'
              mode: 'stored',
            }
          );
          queryRecordsSpan?.end();

          // 5. Transform response field keys if needed
          const transformedRecords =
            query.fieldKeyType !== FieldKeyType.Id
              ? queryResult.records.map((record) => ({
                  ...record,
                  fields: FieldKeyResolverService.transformResponseKeys(
                    table,
                    record.fields,
                    query.fieldKeyType
                  ),
                }))
              : queryResult.records;

          logger.debug('ListTableRecordsHandler.success', {
            count: queryResult.records.length,
            total: queryResult.total,
          });

          return ok(
            ListTableRecordsResult.create(
              transformedRecords,
              queryResult.total,
              query.pagination.offset().toNumber(),
              query.pagination.limit().toNumber()
            )
          );
        }.bind(this)
      );
    } finally {
      span?.end();
    }
  }

  private async buildQueryPlan(
    context: IExecutionContext,
    table: Table,
    query: ListTableRecordsQuery,
    resolvedFilter: RecordFilter | undefined,
    linkCandidatePlan?: {
      candidateSpec?: IncomingLinkCandidateSpec;
      linkFilterSpec?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor> | null;
      filterByViewId?: string;
    }
  ): Promise<
    Result<
      {
        spec?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>;
        recordIdsOrder?: ReadonlyArray<RecordId>;
      },
      DomainError
    >
  > {
    return safeTry(
      async function* (this: ListTableRecordsHandler) {
        const builder = RecordConditionSpecBuilder.create();
        let hasSpec = false;
        let recordIdsOrder: ReadonlyArray<RecordId> | undefined;

        if (resolvedFilter) {
          builder.addConditionSpec(yield* buildRecordConditionSpec(table, resolvedFilter));
          hasSpec = true;
        }

        if (query.filterLinkCellSelected) {
          const selectedPlan = yield* await this.buildIncomingLinkSelectedPlan(
            context,
            table,
            query.filterLinkCellSelected
          );
          builder.addConditionSpec(selectedPlan.spec);
          recordIdsOrder = selectedPlan.recordIdsOrder;
          hasSpec = true;
        }

        if (query.filterLinkCellCandidate) {
          // Use pre-resolved plan from handle() to avoid double DB lookup.
          const plan =
            linkCandidatePlan ??
            (yield* await this.buildLinkCandidatePlan(
              context,
              table,
              query.filterLinkCellCandidate
            ));

          if (plan.candidateSpec) {
            builder.addConditionSpec(plan.candidateSpec);
            hasSpec = true;
          }

          // Apply the link field's custom filter (equivalent to v1 getFormLinkRecords).
          if (plan.linkFilterSpec) {
            builder.addConditionSpec(plan.linkFilterSpec);
            hasSpec = true;
          }
        }

        if (query.selectedRecordIds?.length) {
          const selectedRecordIds = query.selectedRecordIds.map((recordId) =>
            RecordId.create(recordId)
          );
          const invalidSelectedRecordId = selectedRecordIds.find((result) => result.isErr());
          if (invalidSelectedRecordId?.isErr()) {
            return err(invalidSelectedRecordId.error);
          }

          const selectedIdsSpec = RecordByIdsSpec.create(
            selectedRecordIds.map((result) => result._unsafeUnwrap())
          );
          if (query.filterLinkCellCandidate) {
            builder.not((notBuilder) => {
              notBuilder.addConditionSpec(selectedIdsSpec);
              return notBuilder;
            });
          } else {
            builder.addConditionSpec(selectedIdsSpec);
          }
          hasSpec = true;
        }

        return ok({
          spec: hasSpec ? yield* builder.build() : undefined,
          recordIdsOrder,
        });
      }.bind(this)
    );
  }

  private async buildIncomingLinkSelectedPlan(
    context: IExecutionContext,
    table: Table,
    filterLinkCellSelected: string | [string, string]
  ): Promise<
    Result<
      {
        spec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>;
        recordIdsOrder?: ReadonlyArray<RecordId>;
      },
      DomainError
    >
  > {
    return safeTry(
      async function* (this: ListTableRecordsHandler) {
        const fieldId = Array.isArray(filterLinkCellSelected)
          ? filterLinkCellSelected[0]
          : filterLinkCellSelected;
        const hostRecordId = Array.isArray(filterLinkCellSelected)
          ? yield* RecordId.create(filterLinkCellSelected[1])
          : undefined;
        const linkFieldResult = yield* await this.resolveIncomingLinkField(context, table, fieldId);
        const currentTableDbName = yield* table
          .dbTableName()
          .andThen((dbTableName) => dbTableName.value());
        const hostTableDbName = yield* linkFieldResult.hostTable
          .dbTableName()
          .andThen((dbTableName) => dbTableName.value());
        const selfKeyName = yield* linkFieldResult.linkField.selfKeyNameString();
        const fkHostTableName = yield* linkFieldResult.linkField.fkHostTableNameString();
        const foreignKeyName = yield* linkFieldResult.linkField.foreignKeyNameString();

        if (hostRecordId) {
          const hostRecord = yield* await this.tableRecordQueryRepository.findOne(
            context,
            linkFieldResult.hostTable,
            hostRecordId,
            { mode: 'stored' }
          );
          const recordIds = yield* this.extractLinkedRecordIds(
            hostRecord.fields[linkFieldResult.linkField.id().toString()]
          );

          return ok({
            spec: RecordByIdsSpec.create(recordIds),
            recordIdsOrder: recordIds,
          });
        }

        return ok({
          spec:
            fkHostTableName === currentTableDbName || hostTableDbName === currentTableDbName
              ? IncomingLinkSelectedSpec.create({
                  mode: 'currentColumnNotNull',
                  selfKeyName,
                })
              : IncomingLinkSelectedSpec.create({
                  mode: 'hostReferenceExists',
                  selfKeyName,
                  fkHostTableName,
                  foreignKeyName,
                }),
        });
      }.bind(this)
    );
  }

  private async buildLinkCandidatePlan(
    context: IExecutionContext,
    table: Table,
    filterLinkCellCandidate: string | [string, string]
  ): Promise<
    Result<
      {
        candidateSpec?: IncomingLinkCandidateSpec;
        linkFilterSpec?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor> | null;
        filterByViewId?: string;
      },
      DomainError
    >
  > {
    return safeTry(
      async function* (this: ListTableRecordsHandler) {
        const fieldId = Array.isArray(filterLinkCellCandidate)
          ? filterLinkCellCandidate[0]
          : filterLinkCellCandidate;
        const hostRecordId = Array.isArray(filterLinkCellCandidate)
          ? yield* RecordId.create(filterLinkCellCandidate[1])
          : undefined;
        const linkFieldResult = yield* await this.resolveIncomingLinkField(context, table, fieldId);
        const linkField = linkFieldResult.linkField;
        const selfKeyName = yield* linkField.selfKeyNameString();
        const fkHostTableName = yield* linkField.fkHostTableNameString();
        const foreignKeyName = yield* linkField.foreignKeyNameString();

        // Build candidate exclusion spec (OneMany / OneOne relationships only).
        let candidateSpec: IncomingLinkCandidateSpec | undefined;
        if (linkField.relationship().toString() === 'oneMany') {
          candidateSpec = this.isJunctionTable(fkHostTableName)
            ? IncomingLinkCandidateSpec.create({
                mode: 'junctionReferenceAvailable',
                selfKeyName,
                hostRecordId,
                fkHostTableName,
                foreignKeyName,
              })
            : IncomingLinkCandidateSpec.create({
                mode: 'currentColumnAvailable',
                selfKeyName,
                hostRecordId,
              });
        } else if (linkField.relationship().toString() === 'oneOne') {
          candidateSpec =
            selfKeyName === '__id'
              ? IncomingLinkCandidateSpec.create({
                  mode: 'hostReferenceAvailable',
                  selfKeyName,
                  hostRecordId,
                  fkHostTableName,
                  foreignKeyName,
                })
              : IncomingLinkCandidateSpec.create({
                  mode: 'currentColumnAvailable',
                  selfKeyName,
                  hostRecordId,
                });
        }

        // Extract the link field's custom filter (v1 IFilter format stored in options).
        // This mirrors what v1's getFormLinkRecords does: apply the link field's configured filter.
        let linkFilterSpec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor> | null =
          null;
        const rawFilter = linkField.config().filter();
        if (rawFilter !== null && rawFilter !== undefined) {
          const conditionResult = FieldCondition.create({ filter: rawFilter });
          if (conditionResult.isOk()) {
            const specResult = conditionResult.value.toRecordConditionSpec(table);
            if (specResult.isOk()) {
              linkFilterSpec = specResult.value;
            } else {
              this.logger.warn('Failed to build link field filter spec', {
                fieldId,
                error: specResult.error,
              });
            }
          } else {
            this.logger.warn('Failed to parse link field filter', {
              fieldId,
              error: conditionResult.error,
            });
          }
        }

        // Extract filterByViewId so handle() can use it as the effective view.
        const filterByViewId = linkField.filterByViewId()?.toString() ?? undefined;

        return ok({ candidateSpec, linkFilterSpec, filterByViewId });
      }.bind(this)
    );
  }

  private async resolveIncomingLinkField(
    context: IExecutionContext,
    table: Table,
    rawFieldId: string
  ): Promise<Result<{ hostTable: Table; linkField: LinkField }, DomainError>> {
    return safeTry(
      async function* (this: ListTableRecordsHandler) {
        const fieldId = yield* FieldId.create(rawFieldId);
        const hostTables = yield* await this.tableRepository.find(
          context,
          TableByIncomingReferenceToTableSpec.create(table.id())
        );

        for (const hostTable of hostTables) {
          const linkField = hostTable.getFields().find((field): field is LinkField => {
            return field.type().toString() === 'link' && field.id().equals(fieldId);
          });

          if (linkField && linkField.foreignTableId().equals(table.id())) {
            return ok({ hostTable, linkField });
          }
        }

        return err(
          domainError.notFound({
            code: 'field.not_found',
            message: `Field not found: ${rawFieldId}`,
            details: { fieldId: rawFieldId },
          })
        );
      }.bind(this)
    );
  }

  private extractLinkedRecordIds(value: unknown): Result<ReadonlyArray<RecordId>, DomainError> {
    const rawIds = Array.isArray(value)
      ? value
          .map((item) =>
            item && typeof item === 'object' && 'id' in item ? (item.id as unknown) : undefined
          )
          .filter((item): item is string => typeof item === 'string')
      : value && typeof value === 'object' && 'id' in value && typeof value.id === 'string'
        ? [value.id]
        : [];

    const recordIds = rawIds.map((recordId) => RecordId.create(recordId));
    const invalidRecordId = recordIds.find((result) => result.isErr());
    if (invalidRecordId?.isErr()) {
      return err(invalidRecordId.error);
    }

    return ok(recordIds.map((result) => result._unsafeUnwrap()));
  }

  private isJunctionTable(dbTableName: string): boolean {
    if (dbTableName.includes('.')) {
      return dbTableName.split('.')[1]?.startsWith('junction') ?? false;
    }
    return dbTableName.split('_')[1]?.startsWith('junction') ?? false;
  }
}
