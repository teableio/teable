import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { mergeOrderBy, resolveGroupByToOrderBy, resolveOrderBy } from '../commands/shared/orderBy';
import { domainError, isNotFoundError, type DomainError } from '../domain/shared/DomainError';
import { RecordConditionSpecBuilder } from '../domain/table/records/specs/RecordConditionSpecBuilder';
import { TableRecord } from '../domain/table/records/TableRecord';
import { Table } from '../domain/table/Table';
import type { IExecutionContext } from '../ports/ExecutionContext';
import * as TableRecordQueryRepositoryPort from '../ports/TableRecordQueryRepository';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { GetViewLinkRecordsQuery } from './GetViewLinkRecordsQuery';
import { QueryHandler, type IQueryHandler } from './QueryHandler';
import {
  buildRecordConditionSpec,
  replaceCurrentUserTagInFilter,
  sanitizeRecordFilter,
} from './RecordFilterMapper';
import { RecordSearch, resolveVisibleRowSearch } from './RecordSearch';

export type ViewLinkRecord = {
  readonly id: string;
  readonly title?: string;
};

export class GetViewLinkRecordsResult {
  private constructor(readonly records: ReadonlyArray<ViewLinkRecord>) {}

  static create(records: ReadonlyArray<ViewLinkRecord>): GetViewLinkRecordsResult {
    return new GetViewLinkRecordsResult(records);
  }
}

@QueryHandler(GetViewLinkRecordsQuery)
@injectable()
export class GetViewLinkRecordsHandler
  implements IQueryHandler<GetViewLinkRecordsQuery, GetViewLinkRecordsResult>
{
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.tableRecordQueryRepository)
    private readonly tableRecordQueryRepository: TableRecordQueryRepositoryPort.ITableRecordQueryRepository
  ) {}

  async handle(
    context: IExecutionContext,
    query: GetViewLinkRecordsQuery
  ): Promise<Result<GetViewLinkRecordsResult, DomainError>> {
    return safeTry<GetViewLinkRecordsResult, DomainError>(
      async function* (this: GetViewLinkRecordsHandler) {
        const sourceSpec = yield* Table.specs()
          .byId(query.tableId)
          .withViewId(query.viewId)
          .build();
        const sourceTable = yield* (await this.tableRepository.findOne(context, sourceSpec)).mapErr(
          (error) =>
            isNotFoundError(error)
              ? domainError.notFound({
                  code: 'view.not_found',
                  message: `View not found: ${query.viewId.toString()}`,
                })
              : error
        );
        const plan = yield* sourceTable.createViewLinkRecordsQueryPlan({
          viewId: query.viewId,
          fieldId: query.fieldId,
          requestType: query.requestType,
          includeHiddenFields: query.includeHiddenFields,
        });

        const targetSpecBuilder = Table.specs().byId(plan.foreignTableId());
        const filterByViewId = plan.filterByViewId();
        if (filterByViewId) targetSpecBuilder.withViewId(filterByViewId);
        const targetSpec = yield* targetSpecBuilder.build();
        const targetTable = yield* (await this.tableRepository.findOne(context, targetSpec)).mapErr(
          (error) => {
            if (!isNotFoundError(error)) return error;
            return filterByViewId
              ? domainError.notFound({
                  code: 'view.not_found',
                  message: `View not found: ${filterByViewId.toString()}`,
                })
              : domainError.notFound({
                  code: 'table.not_found',
                  message: `Table not found: ${plan.foreignTableId().toString()}`,
                });
          }
        );
        yield* plan.validateTargetTable(targetTable);

        const specBuilder = RecordConditionSpecBuilder.create();
        let hasConditionSpec = false;
        const selectionSpec = yield* plan.selectionSpec(sourceTable, targetTable);
        if (selectionSpec) {
          specBuilder.addConditionSpec(selectionSpec);
          hasConditionSpec = true;
        }
        const linkFilterSpec = yield* plan.linkFilterSpec(targetTable);
        if (linkFilterSpec) {
          specBuilder.addConditionSpec(linkFilterSpec);
          hasConditionSpec = true;
        }

        let orderBy: TableRecordQueryRepositoryPort.ITableRecordQueryOptions['orderBy'];
        if (filterByViewId) {
          const targetView = yield* targetTable.getView(filterByViewId);
          const defaults = yield* targetView.queryDefaults();
          const defaultFilter = replaceCurrentUserTagInFilter(
            targetTable,
            defaults.filter(),
            context.actorId.toString()
          );
          const sanitizedDefaultFilter = yield* sanitizeRecordFilter(targetTable, defaultFilter);
          if (sanitizedDefaultFilter) {
            specBuilder.addConditionSpec(
              yield* buildRecordConditionSpec(targetTable, sanitizedDefaultFilter)
            );
            hasConditionSpec = true;
          }
          const effectiveSort = defaults.manualSort() ? [] : defaults.sort();
          orderBy = mergeOrderBy(
            yield* resolveGroupByToOrderBy(defaults.group()),
            yield* resolveOrderBy(effectiveSort),
            filterByViewId.toString()
          );
        } else {
          orderBy = mergeOrderBy(undefined, undefined, undefined);
        }

        const conditionSpec = hasConditionSpec ? yield* specBuilder.build() : undefined;
        const search = resolveVisibleRowSearch(
          RecordSearch.fromOptionalTuple(
            query.search ? [query.search, plan.lookupFieldId().toString(), true] : undefined
          ),
          [plan.lookupFieldId()]
        );
        const records = yield* await this.tableRecordQueryRepository.find(
          context,
          targetTable,
          conditionSpec,
          {
            mode: 'stored',
            pagination: query.pagination,
            orderBy,
            projectionFieldIds: [plan.lookupFieldId()],
            search,
            includeTotal: false,
          }
        );

        const result: ViewLinkRecord[] = [];
        for (const record of records.records) {
          const domainRecord = yield* TableRecord.fromRawFieldValues({
            id: record.id,
            tableId: targetTable.id(),
            fields: record.fields,
          });
          const title = yield* domainRecord.displayValue(targetTable, plan.lookupFieldId());
          result.push(title == null ? { id: record.id } : { id: record.id, title });
        }
        return ok(GetViewLinkRecordsResult.create(result));
      }.bind(this)
    );
  }
}
