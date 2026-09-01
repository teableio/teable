import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { mergeOrderBy, resolveGroupByToOrderBy, resolveOrderBy } from '../commands/shared/orderBy';
import { domainError, isNotFoundError, type DomainError } from '../domain/shared/DomainError';
import { OffsetPagination } from '../domain/shared/pagination/OffsetPagination';
import { PageLimit } from '../domain/shared/pagination/PageLimit';
import { PageOffset } from '../domain/shared/pagination/PageOffset';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import type { Field } from '../domain/table/fields/Field';
import {
  FieldClipboardValueVisitor,
  stringifyClipboardRows,
} from '../domain/table/fields/visitors/FieldClipboardValueVisitor';
import type { ViewSelectionCopyPlan } from '../domain/table/methods/createViewSelectionCopyPlan';
import type { ITableRecordConditionSpecVisitor } from '../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import type { TableRecord } from '../domain/table/records/TableRecord';
import { Table } from '../domain/table/Table';
import type { ViewQueryGroupItem } from '../domain/table/views/ViewQueryDefaults';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { ITableRecordAggregationQueryRepository } from '../ports/TableRecordQueryRepository';
import type { TableRecordOrderBy } from '../ports/TableRecordQueryRepository';
import type { TableRecordReadModel } from '../ports/TableRecordReadModel';
import { ITableRepository } from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { GetViewSelectionCopyQuery, type ViewSelectionCopySort } from './GetViewSelectionCopyQuery';
import { QueryHandler, type IQueryHandler } from './QueryHandler';
import {
  isRecordFilterCondition,
  isRecordFilterGroup,
  isRecordFilterNot,
  type RecordFilter,
  type RecordFilterNode,
} from './RecordFilterDto';
import {
  buildSanitizedRecordConditionSpec,
  replaceCurrentUserTagInFilter,
  sanitizeRecordFilter,
} from './RecordFilterMapper';
import { RecordSearch, resolveVisibleRowSearch, type RecordQuerySearch } from './RecordSearch';

const mergeFilters = (
  defaultFilter: RecordFilter | null | undefined,
  requestFilter: RecordFilter | undefined
): RecordFilter | undefined => {
  if (!defaultFilter) return requestFilter;
  if (!requestFilter) return defaultFilter;
  return { conjunction: 'and', items: [defaultFilter, requestFilter] };
};

const mergeSort = (
  defaultSort: ReadonlyArray<ViewSelectionCopySort> | undefined,
  manualSort: boolean | undefined,
  requestSort: ReadonlyArray<ViewSelectionCopySort> | undefined
): ReadonlyArray<ViewSelectionCopySort> | undefined => {
  if (manualSort && !requestSort?.length) return [];
  if (!defaultSort?.length) return requestSort;
  if (!requestSort?.length) return defaultSort;
  const merged = new Map(requestSort.map((item) => [item.fieldId, item]));
  for (const item of defaultSort) {
    if (!merged.has(item.fieldId)) merged.set(item.fieldId, item);
  }
  return [...merged.values()];
};

const collectFilterFieldIds = (filter: RecordFilter | undefined, fieldIds: Set<string>): void => {
  const visit = (node: RecordFilterNode): void => {
    if (isRecordFilterCondition(node)) {
      fieldIds.add(node.fieldId);
      if (
        node.value &&
        typeof node.value === 'object' &&
        'fieldId' in node.value &&
        typeof node.value.fieldId === 'string'
      ) {
        fieldIds.add(node.value.fieldId);
      }
      return;
    }
    if (isRecordFilterGroup(node)) {
      node.items.forEach(visit);
      return;
    }
    if (isRecordFilterNot(node)) visit(node.not);
  };
  if (filter) visit(filter);
};

export class GetViewSelectionCopyResult {
  private constructor(
    readonly content: string,
    readonly fields: ReadonlyArray<Field>,
    readonly primaryFieldId: ReturnType<Table['primaryFieldId']>
  ) {}

  static create(
    content: string,
    fields: ReadonlyArray<Field>,
    primaryFieldId: ReturnType<Table['primaryFieldId']>
  ): GetViewSelectionCopyResult {
    return new GetViewSelectionCopyResult(content, fields, primaryFieldId);
  }
}

@QueryHandler(GetViewSelectionCopyQuery)
@injectable()
export class GetViewSelectionCopyHandler
  implements IQueryHandler<GetViewSelectionCopyQuery, GetViewSelectionCopyResult>
{
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: ITableRepository,
    @inject(v2CoreTokens.tableRecordQueryRepository)
    private readonly tableRecordQueryRepository: ITableRecordAggregationQueryRepository
  ) {}

  async handle(
    context: IExecutionContext,
    query: GetViewSelectionCopyQuery
  ): Promise<Result<GetViewSelectionCopyResult, DomainError>> {
    return safeTry<GetViewSelectionCopyResult, DomainError>(
      async function* (this: GetViewSelectionCopyHandler) {
        const tableSpec = yield* Table.specs().byId(query.tableId).withViewId(query.viewId).build();
        const table = yield* (await this.tableRepository.findOne(context, tableSpec)).mapErr(
          (error) =>
            isNotFoundError(error)
              ? domainError.notFound({
                  code: 'view.not_found',
                  message: `View not found: ${query.viewId.toString()}`,
                })
              : error
        );
        const queryFieldIds = new Set<string>();
        collectFilterFieldIds(query.filter, queryFieldIds);
        query.orderBy?.forEach((item) => queryFieldIds.add(item.fieldId));
        query.groupBy?.forEach((item) => queryFieldIds.add(item.fieldId));
        query.search?.[1]
          ?.split(',')
          .map((fieldId) => fieldId.trim())
          .filter((fieldId) => fieldId.startsWith('fld'))
          .forEach((fieldId) => queryFieldIds.add(fieldId));
        const plan = yield* table.createViewSelectionCopyPlan({
          viewId: query.viewId,
          canCopyAsEditor: query.canCopyAsEditor,
          sharedView: query.sharedView,
          ranges: query.ranges,
          type: query.type,
          projection: query.projection,
          queryFieldIds: [...queryFieldIds],
        });
        if (!plan.recordsIncluded || !plan.fields.length) {
          return ok(GetViewSelectionCopyResult.create('', plan.fields, table.primaryFieldId()));
        }

        const view = yield* table.getView(query.viewId);
        const defaults = yield* view.queryDefaults();
        const defaultFilter = replaceCurrentUserTagInFilter(
          table,
          defaults.filter(),
          context.actorId.toString()
        );
        const requestFilter = replaceCurrentUserTagInFilter(
          table,
          query.filter,
          context.actorId.toString()
        );
        let effectiveFilter = mergeFilters(
          yield* sanitizeRecordFilter(table, defaultFilter),
          yield* sanitizeRecordFilter(table, requestFilter)
        );
        const effectiveGroup: ReadonlyArray<ViewQueryGroupItem> | undefined = query.groupBy?.length
          ? query.groupBy.slice(0, 3)
          : defaults.group();
        const effectiveSort = mergeSort(defaults.sort(), defaults.manualSort(), query.orderBy);
        const orderBy = mergeOrderBy(
          yield* resolveGroupByToOrderBy(effectiveGroup),
          yield* resolveOrderBy(effectiveSort),
          query.viewId.toString()
        );
        const search = resolveVisibleRowSearch(
          RecordSearch.fromOptionalTuple(query.search),
          plan.searchFieldIds
        );
        let conditionSpec = yield* buildSanitizedRecordConditionSpec(table, effectiveFilter);
        if (query.collapsedGroupIds?.length && effectiveGroup?.length) {
          const aggregation = yield* table.createRecordAggregation({
            viewId: query.viewId.toString(),
            fields: [
              {
                fieldId: table.primaryFieldId().toString(),
                statisticFunc: 'count',
              },
            ],
            groupBy: effectiveGroup,
            includeHiddenFields: false,
          });
          const aggregationValues = yield* await this.tableRecordQueryRepository.aggregate(
            context,
            table,
            aggregation,
            conditionSpec,
            {
              maxGroupPoints: query.maxGroupPoints,
              search,
            }
          );
          const groupedRows = aggregationValues
            .filter((value) => value.groupValues?.length === effectiveGroup.length)
            .map((value) => ({ groupValues: value.groupValues! }));
          const collapsedFilter = yield* table.createCollapsedGroupExclusionFilter(
            effectiveGroup,
            groupedRows,
            new Set(query.collapsedGroupIds)
          );
          effectiveFilter = mergeFilters(effectiveFilter, collapsedFilter);
          conditionSpec = yield* buildSanitizedRecordConditionSpec(table, effectiveFilter);
        }

        const records =
          plan.type === 'columns'
            ? yield* await this.readColumnSelection(
                context,
                table,
                plan,
                conditionSpec,
                orderBy,
                search,
                query.maxCopyCells
              )
            : yield* await this.readBoundedSelection(
                context,
                table,
                plan,
                conditionSpec,
                orderBy,
                search,
                query.maxCopyCells
              );
        const rows: string[][] = [];
        for (const record of records) {
          const row: string[] = [];
          for (const field of plan.fields) {
            row.push(
              yield* field.accept(
                new FieldClipboardValueVisitor(record.fields[field.id().toString()])
              )
            );
          }
          rows.push(row);
        }
        return ok(
          GetViewSelectionCopyResult.create(
            stringifyClipboardRows(rows),
            plan.fields,
            table.primaryFieldId()
          )
        );
      }.bind(this)
    );
  }

  private async readColumnSelection(
    context: IExecutionContext,
    table: Table,
    plan: ViewSelectionCopyPlan,
    conditionSpec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor> | undefined,
    orderBy: ReadonlyArray<TableRecordOrderBy> | undefined,
    search: RecordQuerySearch | undefined,
    maxCopyCells: number
  ): Promise<Result<ReadonlyArray<TableRecordReadModel>, DomainError>> {
    const maxRows = Math.floor(maxCopyCells / plan.fields.length);
    const pagination = OffsetPagination.create(
      PageLimit.create(maxRows + 1)._unsafeUnwrap(),
      PageOffset.create(0)._unsafeUnwrap()
    );
    const result = await this.tableRecordQueryRepository.find(context, table, conditionSpec, {
      pagination,
      orderBy,
      search,
      mode: 'stored',
      projectionFieldIds: plan.fields.map((field) => field.id()),
      includeTotal: true,
    });
    return result.andThen((value) =>
      plan.requestedCellCount(value.total).andThen((cellCount) =>
        cellCount > maxCopyCells
          ? err(
              domainError.validation({
                code: 'view_selection_copy.exceed_max_copy_cells',
                message: `Exceed max copy cells ${maxCopyCells}`,
              })
            )
          : ok(value.records)
      )
    );
  }

  private async readBoundedSelection(
    context: IExecutionContext,
    table: Table,
    plan: ViewSelectionCopyPlan,
    conditionSpec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor> | undefined,
    orderBy: ReadonlyArray<TableRecordOrderBy> | undefined,
    search: RecordQuerySearch | undefined,
    maxCopyCells: number
  ): Promise<Result<ReadonlyArray<TableRecordReadModel>, DomainError>> {
    const cellCount = plan.requestedCellCount();
    if (cellCount.isErr()) return err(cellCount.error);
    if (cellCount.value > maxCopyCells) {
      return err(
        domainError.validation({
          code: 'view_selection_copy.exceed_max_copy_cells',
          message: `Exceed max copy cells ${maxCopyCells}`,
        })
      );
    }

    const records: TableRecordReadModel[] = [];
    for (const window of plan.recordWindows) {
      const pagination = OffsetPagination.create(
        PageLimit.create(window.limit!)._unsafeUnwrap(),
        PageOffset.create(window.offset)._unsafeUnwrap()
      );
      const result = await this.tableRecordQueryRepository.find(context, table, conditionSpec, {
        pagination,
        orderBy,
        search,
        mode: 'stored',
        projectionFieldIds: plan.fields.map((field) => field.id()),
        includeTotal: false,
      });
      if (result.isErr()) return err(result.error);
      records.push(...result.value.records);
    }
    return ok(records);
  }
}
