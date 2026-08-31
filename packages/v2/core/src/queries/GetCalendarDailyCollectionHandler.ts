import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, isNotFoundError, type DomainError } from '../domain/shared/DomainError';
import { RecordByIdsSpec } from '../domain/table/records/specs/RecordByIdsSpec';
import { Table } from '../domain/table/Table';
import type { IExecutionContext } from '../ports/ExecutionContext';
import * as LoggerPort from '../ports/Logger';
import {
  ITableRecordCalendarQueryRepository,
  type TableRecordCalendarDailyCollectionEntry,
} from '../ports/TableRecordQueryRepository';
import type { TableRecordReadModel } from '../ports/TableRecordReadModel';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { GetCalendarDailyCollectionQuery } from './GetCalendarDailyCollectionQuery';
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

export class GetCalendarDailyCollectionResult {
  private constructor(
    readonly countMap: Readonly<Record<string, number>>,
    readonly records: ReadonlyArray<TableRecordReadModel>
  ) {}

  static create(
    entries: ReadonlyArray<TableRecordCalendarDailyCollectionEntry>,
    records: ReadonlyArray<TableRecordReadModel>
  ): GetCalendarDailyCollectionResult {
    return new GetCalendarDailyCollectionResult(
      Object.fromEntries(entries.map((entry) => [entry.date, entry.count])),
      records
    );
  }
}

@QueryHandler(GetCalendarDailyCollectionQuery)
@injectable()
export class GetCalendarDailyCollectionHandler
  implements IQueryHandler<GetCalendarDailyCollectionQuery, GetCalendarDailyCollectionResult>
{
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.tableRecordQueryRepository)
    private readonly tableRecordQueryRepository: ITableRecordCalendarQueryRepository,
    @inject(v2CoreTokens.logger)
    private readonly logger: LoggerPort.ILogger
  ) {}

  async handle(
    context: IExecutionContext,
    query: GetCalendarDailyCollectionQuery
  ): Promise<Result<GetCalendarDailyCollectionResult, DomainError>> {
    const logger = this.logger
      .scope('query', { name: GetCalendarDailyCollectionHandler.name })
      .child({
        tableId: query.tableId.toString(),
        viewId: query.viewId.toString(),
      });

    return safeTry<GetCalendarDailyCollectionResult, DomainError>(
      async function* (this: GetCalendarDailyCollectionHandler) {
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
        const calendar = yield* table.createRecordCalendarDailyCollection({
          viewId: query.viewId.toString(),
          startFieldId: query.startDateFieldId,
          endFieldId: query.endDateFieldId,
          includeHiddenFields: query.includeHiddenFields,
        });
        const visibleFieldIds = query.includeHiddenFields
          ? table.fieldIds()
          : yield* table.getOrderedVisibleFieldIds(query.viewId.toString());
        const visibleRowSearch = resolveVisibleRowSearch(
          RecordSearch.fromOptionalTuple(query.search),
          visibleFieldIds
        );
        const entries = yield* await this.tableRecordQueryRepository.calendarDailyCollection(
          context,
          table,
          calendar,
          { startDate: query.startDate, endDate: query.endDate },
          conditionSpec,
          { search: visibleRowSearch }
        );
        const recordIds = [
          ...new Map(
            entries.flatMap((entry) =>
              entry.recordIds.map((recordId) => [recordId.toString(), recordId] as const)
            )
          ).values(),
        ];
        if (!recordIds.length) {
          return ok(GetCalendarDailyCollectionResult.create(entries, []));
        }

        const recordsResult = yield* await this.tableRecordQueryRepository.find(
          context,
          table,
          RecordByIdsSpec.create(recordIds),
          {
            mode: 'stored',
            projectionFieldIds: visibleFieldIds,
            recordIdsOrder: recordIds,
            includeTotal: false,
          }
        );
        logger.debug('GetCalendarDailyCollectionHandler.success', {
          dateCount: entries.length,
          recordCount: recordsResult.records.length,
        });
        return ok(GetCalendarDailyCollectionResult.create(entries, recordsResult.records));
      }.bind(this)
    ).orElse((error) => {
      logger.error('GetCalendarDailyCollectionHandler.failed', { error: error.toString() });
      return err(error);
    });
  }
}
