import { inject, injectable } from '@teable/v2-di';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, isNotFoundError, type DomainError } from '../domain/shared/DomainError';
import type { Table } from '../domain/table/Table';
import { Table as TableAggregate } from '../domain/table/Table';
import type { IExecutionContext } from '../ports/ExecutionContext';
import * as LoggerPort from '../ports/Logger';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { GetTableByIdQuery } from './GetTableByIdQuery';
import { QueryHandler, type IQueryHandler } from './QueryHandler';

export class GetTableByIdResult {
  private constructor(readonly table: Table) {}

  static create(table: Table): GetTableByIdResult {
    return new GetTableByIdResult(table);
  }
}

@QueryHandler(GetTableByIdQuery)
@injectable()
export class GetTableByIdHandler implements IQueryHandler<GetTableByIdQuery, GetTableByIdResult> {
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.logger)
    private readonly logger: LoggerPort.ILogger
  ) {}

  async handle(
    context: IExecutionContext,
    query: GetTableByIdQuery
  ): Promise<Result<GetTableByIdResult, DomainError>> {
    const logger = this.logger.scope('query', { name: GetTableByIdHandler.name }).child({
      baseId: query.baseId.toString(),
      tableId: query.tableId.toString(),
    });
    logger.debug('GetTableByIdHandler.start', {
      actorId: context.actorId.toString(),
    });

    const specResult = TableAggregate.specs(query.baseId).byId(query.tableId).build();
    if (specResult.isErr()) return err(specResult.error);

    const tableResult = await this.tableRepository.findOne(context, specResult.value);
    if (tableResult.isErr()) {
      if (isNotFoundError(tableResult.error)) {
        return err(domainError.notFound({ code: 'table.not_found', message: 'Table not found' }));
      }
      return err(tableResult.error);
    }
    logger.debug('GetTableByIdHandler.success');

    return ok(GetTableByIdResult.create(tableResult.value));
  }
}
