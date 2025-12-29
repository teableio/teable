import { inject, injectable } from '@teable/v2-di';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { TableRecord } from '../domain/table/records/TableRecord';
import { Table as TableAggregate } from '../domain/table/Table';
import type { IExecutionContext } from '../ports/ExecutionContext';
import * as LoggerPort from '../ports/Logger';
import * as TableRecordQueryRepositoryPort from '../ports/TableRecordQueryRepository';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { ListTableRecordsQuery } from './ListTableRecordsQuery';
import { QueryHandler, type IQueryHandler } from './QueryHandler';

export class ListTableRecordsResult {
  private constructor(readonly records: ReadonlyArray<TableRecord>) {}

  static create(records: ReadonlyArray<TableRecord>): ListTableRecordsResult {
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
  ): Promise<Result<ListTableRecordsResult, string>> {
    const logger = this.logger.scope('query', { name: ListTableRecordsHandler.name }).child({
      baseId: query.baseId.toString(),
      tableId: query.tableId.toString(),
    });
    logger.debug('ListTableRecordsHandler.start', {
      actorId: context.actorId.toString(),
    });

    const specResult = TableAggregate.specs(query.baseId).byId(query.tableId).build();
    if (specResult.isErr()) return err(specResult.error);

    const tableResult = await this.tableRepository.findOne(context, specResult.value);
    if (tableResult.isErr()) {
      if (tableResult.error === 'Not found') return err('Table not found');
      return err(tableResult.error);
    }

    const recordsResult = await this.tableRecordQueryRepository.find(context, tableResult.value);
    if (recordsResult.isErr()) return err(recordsResult.error);

    logger.debug('ListTableRecordsHandler.success', {
      count: recordsResult.value.length,
    });
    return ok(ListTableRecordsResult.create(recordsResult.value));
  }
}
