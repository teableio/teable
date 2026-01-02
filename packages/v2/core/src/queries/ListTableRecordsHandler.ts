import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, isNotFoundError, type DomainError } from '../domain/shared/DomainError';
import { TableByIdSpec } from '../domain/table/specs/TableByIdSpec';
import type { IExecutionContext } from '../ports/ExecutionContext';
import * as LoggerPort from '../ports/Logger';
import * as TableRecordQueryRepositoryPort from '../ports/TableRecordQueryRepository';
import type { TableRecordReadModel } from '../ports/TableRecordReadModel';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { ListTableRecordsQuery } from './ListTableRecordsQuery';
import { QueryHandler, type IQueryHandler } from './QueryHandler';
import { buildRecordConditionSpec } from './RecordFilterMapper';

export class ListTableRecordsResult {
  private constructor(readonly records: ReadonlyArray<TableRecordReadModel>) {}

  static create(records: ReadonlyArray<TableRecordReadModel>): ListTableRecordsResult {
    return new ListTableRecordsResult(records);
  }
}

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

    return safeTry<ListTableRecordsResult, DomainError>(
      async function* (this: ListTableRecordsHandler) {
        // 1. Load main table (tableId is globally unique)
        const tableSpec = TableByIdSpec.create(query.tableId);
        const table = yield* (await this.tableRepository.findOne(context, tableSpec)).mapErr(
          (error: DomainError) =>
            isNotFoundError(error)
              ? domainError.notFound({ code: 'table.not_found', message: 'Table not found' })
              : error
        );

        // 2. Build filter spec
        const filterSpec = query.filter
          ? yield* buildRecordConditionSpec(table, query.filter)
          : undefined;

        // 3. Query records (repository handles foreign table loading via query builder prepare)
        const records = yield* await this.tableRecordQueryRepository.find(
          context,
          table,
          filterSpec
        );

        logger.debug('ListTableRecordsHandler.success', { count: records.length });
        return ok(ListTableRecordsResult.create(records));
      }.bind(this)
    );
  }
}
