import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, isNotFoundError, type DomainError } from '../domain/shared/DomainError';
import type { TableRecordAggregationGroup } from '../domain/table/records/TableRecordAggregation';
import { Table } from '../domain/table/Table';
import type { IExecutionContext } from '../ports/ExecutionContext';
import * as LoggerPort from '../ports/Logger';
import {
  ITableRecordAggregationQueryRepository,
  type TableRecordAggregationValue,
} from '../ports/TableRecordQueryRepository';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { AggregateTableRecordsQuery } from './AggregateTableRecordsQuery';
import { QueryHandler, type IQueryHandler } from './QueryHandler';
import type { RecordFilter } from './RecordFilterDto';
import {
  buildSanitizedRecordConditionSpec,
  replaceCurrentUserTagInFilter,
  sanitizeRecordFilter,
} from './RecordFilterMapper';
import { RecordSearch, resolveVisibleRowSearch } from './RecordSearch';

const mergeFilters = (
  defaultFilter: RecordFilter | null | undefined,
  requestFilter: RecordFilter | null | undefined
): RecordFilter | undefined => {
  if (!defaultFilter) return requestFilter ?? undefined;
  if (!requestFilter) return defaultFilter;
  return { conjunction: 'and', items: [defaultFilter, requestFilter] };
};

export class AggregateTableRecordsResult {
  private constructor(
    readonly values: ReadonlyArray<TableRecordAggregationValue>,
    readonly groupBy: ReadonlyArray<TableRecordAggregationGroup>
  ) {}

  static create(
    values: ReadonlyArray<TableRecordAggregationValue>,
    groupBy: ReadonlyArray<TableRecordAggregationGroup> = []
  ): AggregateTableRecordsResult {
    return new AggregateTableRecordsResult(values, groupBy);
  }
}

@QueryHandler(AggregateTableRecordsQuery)
@injectable()
export class AggregateTableRecordsHandler
  implements IQueryHandler<AggregateTableRecordsQuery, AggregateTableRecordsResult>
{
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.tableRecordQueryRepository)
    private readonly tableRecordQueryRepository: ITableRecordAggregationQueryRepository,
    @inject(v2CoreTokens.logger)
    private readonly logger: LoggerPort.ILogger
  ) {}

  async handle(
    context: IExecutionContext,
    query: AggregateTableRecordsQuery
  ): Promise<Result<AggregateTableRecordsResult, DomainError>> {
    const logger = this.logger.scope('query', { name: AggregateTableRecordsHandler.name }).child({
      tableId: query.tableId.toString(),
      viewId: query.viewId.toString(),
    });

    return safeTry<AggregateTableRecordsResult, DomainError>(
      async function* (this: AggregateTableRecordsHandler) {
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
        const sanitizedDefaultFilter = yield* sanitizeRecordFilter(table, defaultFilter);
        const sanitizedRequestFilter = yield* sanitizeRecordFilter(table, requestFilter);
        const effectiveFilter = mergeFilters(sanitizedDefaultFilter, sanitizedRequestFilter);
        const conditionSpec = yield* buildSanitizedRecordConditionSpec(table, effectiveFilter);
        const aggregation = yield* table.createRecordAggregation({
          viewId: query.viewId.toString(),
          fields: query.fields,
          groupBy: query.groupBy,
          includeHiddenFields: query.includeHiddenFields,
        });
        const searchVisibleFieldIds = query.includeHiddenFields
          ? table.fieldIds()
          : yield* table.getOrderedVisibleFieldIds(query.viewId.toString());
        const visibleRowSearch = resolveVisibleRowSearch(
          RecordSearch.fromOptionalTuple(query.search),
          searchVisibleFieldIds
        );

        const values = yield* await this.tableRecordQueryRepository.aggregate(
          context,
          table,
          aggregation,
          conditionSpec,
          {
            maxGroupPoints: query.maxGroupPoints,
            search: visibleRowSearch,
          }
        );
        logger.debug('AggregateTableRecordsHandler.success', {
          fieldCount: aggregation.fields.length,
          groupDepth: aggregation.groupBy.length,
          valueCount: values.length,
        });
        return ok(AggregateTableRecordsResult.create(values, aggregation.groupBy));
      }.bind(this)
    ).orElse((error) => {
      logger.error('AggregateTableRecordsHandler.failed', { error: error.toString() });
      return err(error);
    });
  }
}
