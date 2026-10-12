import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, isNotFoundError, type DomainError } from '../domain/shared/DomainError';
import { composeAndSpecsOrUndefined } from '../domain/shared/specification/composeAndSpecs';
import { FieldId } from '../domain/table/fields/FieldId';
import { RecordByIdsSpec } from '../domain/table/records/specs/RecordByIdsSpec';
import { TableByIdSpec } from '../domain/table/specs/TableByIdSpec';
import type { IExecutionContext } from '../ports/ExecutionContext';
import * as LoggerPort from '../ports/Logger';
import type { RecordQueryPluginScope } from '../ports/RecordQueryPlugin';
import {
  ITableRecordCalendarQueryRepository,
  type TableRecordCalendarDailyCollectionEntry,
} from '../ports/TableRecordQueryRepository';
import type { TableRecordReadModel } from '../ports/TableRecordReadModel';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { GetCalendarDailyCollectionQuery } from './GetCalendarDailyCollectionQuery';
import { QueryHandler, type IQueryHandler } from './QueryHandler';
import {
  buildRecordConditionSpec,
  replaceCurrentUserTagInFilter,
  sanitizeRecordFilter,
} from './RecordFilterMapper';
import { RecordSearch, resolveVisibleRowSearch } from './RecordSearch';
import { applyFieldMasksToRecords, collectMaskDependencyFieldIds } from './tableRecordFieldMasks';
import {
  filterFieldIdsByEnabledFieldIds,
  filterFieldIdsByQueryAccess,
  getEnabledFieldIdSet,
  mergeFilterWithViewDefaults,
  sanitizeFilterByEnabledFieldIds,
} from './tableRecordQueryPlan';

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
        viewId: query.viewId?.toString(),
      });

    return safeTry<GetCalendarDailyCollectionResult, DomainError>(
      async function* (this: GetCalendarDailyCollectionHandler) {
        const preloadedTable = query.table?.id().equals(query.tableId) ? query.table : undefined;
        const table =
          preloadedTable ??
          (yield* (
            await this.tableRepository.findOne(context, TableByIdSpec.create(query.tableId))
          ).mapErr((error) =>
            isNotFoundError(error)
              ? domainError.notFound({ code: 'table.not_found', message: 'Table not found' })
              : error
          ));
        const view = query.viewId ? yield* table.getView(query.viewId) : undefined;
        const defaults = view && !query.ignoreViewQuery ? yield* view.queryDefaults() : undefined;
        const enabledFieldIds = getEnabledFieldIdSet(query);
        const maskedFieldIds = query.queryScope?.fieldMasks?.length
          ? new Set(query.queryScope.fieldMasks.map((mask) => mask.fieldId))
          : undefined;
        const defaultFilter = replaceCurrentUserTagInFilter(
          table,
          defaults?.filter(),
          context.actorId.toString()
        );
        const requestFilter = replaceCurrentUserTagInFilter(
          table,
          query.filter,
          context.actorId.toString()
        );
        const sanitizedDefaultFilter = yield* sanitizeRecordFilter(table, defaultFilter);
        const sanitizedRequestFilter = yield* sanitizeRecordFilter(table, requestFilter);
        const permissionDefaultFilter = yield* sanitizeFilterByEnabledFieldIds(
          sanitizedDefaultFilter ?? undefined,
          enabledFieldIds,
          maskedFieldIds,
          'strip'
        );
        const permissionRequestFilter = yield* sanitizeFilterByEnabledFieldIds(
          sanitizedRequestFilter ?? undefined,
          enabledFieldIds,
          maskedFieldIds,
          'reject'
        );
        const effectiveFilter = mergeFilterWithViewDefaults(
          permissionDefaultFilter,
          permissionRequestFilter
        );
        const filterSpec = effectiveFilter
          ? yield* buildRecordConditionSpec(table, effectiveFilter, query.queryScope?.fieldMasks)
          : undefined;
        const conditionSpec = composeAndSpecsOrUndefined(
          [
            filterSpec,
            query.queryScope?.skipRecordSpec ? undefined : query.queryScope?.recordSpec,
          ].filter(
            (spec): spec is NonNullable<RecordQueryPluginScope['recordSpec']> => spec != null
          )
        );
        const calendar = yield* table.createRecordCalendarDailyCollection({
          viewId: query.viewId?.toString(),
          startFieldId: query.startDateFieldId,
          endFieldId: query.endDateFieldId,
          includeHiddenFields: query.includeHiddenFields,
        });
        for (const fieldId of [calendar.startFieldId, calendar.endFieldId]) {
          if (
            enabledFieldIds &&
            !enabledFieldIds.has(fieldId.toString()) &&
            !maskedFieldIds?.has(fieldId.toString())
          ) {
            return err(
              domainError.forbidden({
                code: 'calendar.field_unreadable',
                message: 'Calendar date field is not readable',
                details: { fieldId: fieldId.toString() },
              })
            );
          }
        }
        const visibleFieldIds =
          query.includeHiddenFields || !query.viewId
            ? table.fieldIds()
            : yield* table.getOrderedVisibleFieldIds(query.viewId.toString());
        const projectionFieldIds = filterFieldIdsByEnabledFieldIds(
          visibleFieldIds,
          enabledFieldIds
        );
        const visibleRowSearch = resolveVisibleRowSearch(
          RecordSearch.fromOptionalTuple(query.search),
          filterFieldIdsByQueryAccess(visibleFieldIds, enabledFieldIds, maskedFieldIds)
        );
        const entries = yield* await this.tableRecordQueryRepository.calendarDailyCollection(
          context,
          table,
          calendar,
          { startDate: query.startDate, endDate: query.endDate },
          conditionSpec,
          {
            search: visibleRowSearch,
            searchAccessPath: query.recordSearchAccessPath,
            fieldMasks: query.queryScope?.fieldMasks,
          }
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

        const requestedProjection = new Set(projectionFieldIds.map(String));
        const fieldMasks = query.queryScope?.fieldMasks?.filter((mask) =>
          requestedProjection.has(mask.fieldId)
        );
        const evaluationFieldIds = new Set([
          ...requestedProjection,
          ...collectMaskDependencyFieldIds(fieldMasks),
        ]);
        const evaluationProjection = [];
        for (const fieldId of evaluationFieldIds) {
          evaluationProjection.push(yield* FieldId.create(fieldId));
        }
        const recordSpec = composeAndSpecsOrUndefined(
          [RecordByIdsSpec.create(recordIds), conditionSpec].filter(
            (spec): spec is NonNullable<RecordQueryPluginScope['recordSpec']> => spec != null
          )
        );
        const recordsResult = yield* await this.tableRecordQueryRepository.find(
          context,
          table,
          recordSpec,
          {
            mode: 'stored',
            projectionFieldIds: evaluationProjection,
            recordIdsOrder: recordIds,
            includeTotal: false,
          }
        );
        const records = applyFieldMasksToRecords(
          table,
          recordsResult.records,
          fieldMasks,
          evaluationFieldIds
        ).map((record) => ({
          ...record,
          fields: Object.fromEntries(
            Object.entries(record.fields).filter(([fieldId]) => requestedProjection.has(fieldId))
          ),
        }));
        logger.debug('GetCalendarDailyCollectionHandler.success', {
          dateCount: entries.length,
          recordCount: recordsResult.records.length,
        });
        return ok(GetCalendarDailyCollectionResult.create(entries, records));
      }.bind(this)
    ).orElse((error) => {
      logger.error('GetCalendarDailyCollectionHandler.failed', { error: error.toString() });
      return err(error);
    });
  }
}
