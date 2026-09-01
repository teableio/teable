import { inject, injectable } from '@teable/v2-di';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, isNotFoundError, type DomainError } from '../domain/shared/DomainError';
import { Table } from '../domain/table/Table';
import type { IExecutionContext } from '../ports/ExecutionContext';
import * as LoggerPort from '../ports/Logger';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { GetDefaultViewIdQuery } from './GetDefaultViewIdQuery';
import { QueryHandler, type IQueryHandler } from './QueryHandler';

export class GetDefaultViewIdResult {
  private constructor(readonly viewId: string) {}

  static create(viewId: string): GetDefaultViewIdResult {
    return new GetDefaultViewIdResult(viewId);
  }
}

@QueryHandler(GetDefaultViewIdQuery)
@injectable()
export class GetDefaultViewIdHandler
  implements IQueryHandler<GetDefaultViewIdQuery, GetDefaultViewIdResult>
{
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.logger)
    private readonly logger: LoggerPort.ILogger
  ) {}

  async handle(
    context: IExecutionContext,
    query: GetDefaultViewIdQuery
  ): Promise<Result<GetDefaultViewIdResult, DomainError>> {
    const logger = this.logger.scope('query', { name: GetDefaultViewIdHandler.name }).child({
      tableId: query.tableId.toString(),
    });
    logger.debug('GetDefaultViewIdHandler.start', { actorId: context.actorId.toString() });

    const specResult = Table.specs().byId(query.tableId).build();
    if (specResult.isErr()) return err(specResult.error);

    const tableResult = await this.tableRepository.findOne(context, specResult.value);
    if (tableResult.isErr()) {
      if (isNotFoundError(tableResult.error)) {
        return err(domainError.notFound({ code: 'table.not_found', message: 'Table not found' }));
      }
      return err(tableResult.error);
    }

    const defaultViewResult = tableResult.value.defaultView();
    if (defaultViewResult.isErr()) return err(defaultViewResult.error);

    const viewId = defaultViewResult.value.id().toString();
    logger.debug('GetDefaultViewIdHandler.success', { viewId });
    return ok(GetDefaultViewIdResult.create(viewId));
  }
}
