import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { FieldKeyResolverService } from '../application/services/FieldKeyResolverService';
import { domainError, isNotFoundError, type DomainError } from '../domain/shared/DomainError';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldKeyType } from '../domain/table/fields/FieldKeyType';
import { TableByIdSpec } from '../domain/table/specs/TableByIdSpec';
import type { Table } from '../domain/table/Table';
import type { IExecutionContext } from '../ports/ExecutionContext';
import * as LoggerPort from '../ports/Logger';
import * as TableRecordQueryRepositoryPort from '../ports/TableRecordQueryRepository';
import type { TableRecordReadModel } from '../ports/TableRecordReadModel';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import {
  ListTableRecordsQuery,
  type RecordSearchValue,
  type RecordSortValue,
} from './ListTableRecordsQuery';
import { QueryHandler, type IQueryHandler } from './QueryHandler';
import {
  isRecordFilterCondition,
  isRecordFilterFieldReferenceValue,
  isRecordFilterGroup,
  isRecordFilterNot,
  type RecordFilter,
  type RecordFilterCondition,
  type RecordFilterNode,
} from './RecordFilterDto';
import { buildRecordConditionSpec } from './RecordFilterMapper';

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

const mergeSearchFilter = (
  filter: RecordFilter,
  search: RecordSearchValue | undefined
): RecordFilter => {
  if (!search) return filter ?? null;
  const [term, fieldKey] = search;
  const searchCondition: RecordFilterCondition = {
    fieldId: fieldKey,
    operator: 'contains',
    value: term,
  };

  if (!filter) return searchCondition;
  if (isRecordFilterGroup(filter) && filter.conjunction === 'and') {
    return { ...filter, items: [...filter.items, searchCondition] };
  }
  return { conjunction: 'and', items: [filter, searchCondition] };
};

const resolveOrderBy = (
  table: Table,
  sort: RecordSortValue | undefined,
  fieldKeyType: FieldKeyType
): Result<
  ReadonlyArray<TableRecordQueryRepositoryPort.TableRecordOrderBy> | undefined,
  DomainError
> => {
  if (!sort) return ok(undefined);
  return FieldKeyResolverService.resolveFieldKey(table, sort.fieldId, fieldKeyType).andThen(
    (fieldId) =>
      FieldId.create(fieldId).map((resolved) => [
        {
          fieldId: resolved,
          direction: sort.order,
        },
      ])
  );
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

          // 2. Resolve field keys in filter if needed
          const mergedFilter = mergeSearchFilter(query.filter ?? null, query.search);
          const resolvedFilter = mergedFilter
            ? yield* resolveFilterFieldKeys(table, mergedFilter, query.fieldKeyType)
            : undefined;
          const orderBy = yield* resolveOrderBy(table, query.sort?.[0], query.fieldKeyType);

          // 3. Build filter spec
          const filterSpec = resolvedFilter
            ? yield* buildRecordConditionSpec(table, resolvedFilter)
            : undefined;

          // 4. Query records with pagination
          const queryRecordsSpan = context.tracer?.startSpan(
            'teable.ListTableRecordsHandler.queryRecords'
          );
          const queryResult = yield* await this.tableRecordQueryRepository.find(
            context,
            table,
            filterSpec,
            {
              pagination: query.pagination,
              orderBy,
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
}
