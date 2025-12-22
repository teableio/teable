import { inject, injectable } from '@teable/v2-di';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { Table } from '../domain/table/Table';
import { Table as TableAggregate } from '../domain/table/Table';
import type { IExecutionContext } from '../ports/ExecutionContext';
import * as LoggerPort from '../ports/Logger';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { ListTablesQuery } from './ListTablesQuery';
import { QueryHandler, type IQueryHandler } from './QueryHandler';

export class ListTablesResult {
  private constructor(readonly tables: ReadonlyArray<Table>) {}

  static create(tables: ReadonlyArray<Table>): ListTablesResult {
    return new ListTablesResult(tables);
  }
}

@QueryHandler(ListTablesQuery)
@injectable()
export class ListTablesHandler implements IQueryHandler<ListTablesQuery, ListTablesResult> {
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.logger)
    private readonly logger: LoggerPort.ILogger
  ) {}

  async handle(
    context: IExecutionContext,
    query: ListTablesQuery
  ): Promise<Result<ListTablesResult, string>> {
    this.logger.debug('ListTablesHandler.start', {
      actorId: context.actorId.toString(),
      baseId: query.baseId.toString(),
    });

    const specResult = TableAggregate.specs(query.baseId).build();
    if (specResult.isErr()) return err(specResult.error);

    const tablesResult = await this.tableRepository.find(context, specResult.value, {
      sort: query.sort,
      pagination: query.pagination,
    });
    if (tablesResult.isErr()) return err(tablesResult.error);

    this.logger.debug('ListTablesHandler.success', {
      baseId: query.baseId.toString(),
      count: tablesResult.value.length,
    });

    return ok(ListTablesResult.create(tablesResult.value));
  }
}
