import { inject, injectable } from '@teable/v2-di';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, isNotFoundError, type DomainError } from '../domain/shared/DomainError';
import { Table } from '../domain/table/Table';
import type { IExecutionContext } from '../ports/ExecutionContext';
import * as LoggerPort from '../ports/Logger';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { GetViewQuery } from './GetViewQuery';
import { QueryHandler, type IQueryHandler } from './QueryHandler';
import { projectViewForQuery, type ViewQueryResultView } from './ViewQueryProjection';

export type GetViewResultView = ViewQueryResultView;

export class GetViewResult {
  private constructor(readonly view: GetViewResultView) {}

  static create(view: GetViewResultView): GetViewResult {
    return new GetViewResult(view);
  }
}

@QueryHandler(GetViewQuery)
@injectable()
export class GetViewHandler implements IQueryHandler<GetViewQuery, GetViewResult> {
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.logger)
    private readonly logger: LoggerPort.ILogger
  ) {}

  async handle(
    context: IExecutionContext,
    query: GetViewQuery
  ): Promise<Result<GetViewResult, DomainError>> {
    const logger = this.logger.scope('query', { name: GetViewHandler.name }).child({
      tableId: query.tableId.toString(),
      viewId: query.viewId.toString(),
    });
    logger.debug('GetViewHandler.start', { actorId: context.actorId.toString() });

    const specResult = Table.specs().byId(query.tableId).withViewId(query.viewId).build();
    if (specResult.isErr()) return err(specResult.error);

    const tableResult = await this.tableRepository.findOne(context, specResult.value);
    if (tableResult.isErr()) {
      if (isNotFoundError(tableResult.error)) {
        return err(
          domainError.notFound({
            code: 'view.not_found',
            message: `View not found: ${query.viewId.toString()}`,
          })
        );
      }
      return err(tableResult.error);
    }

    const viewResult = tableResult.value.getView(query.viewId);
    if (viewResult.isErr()) {
      return err(
        domainError.notFound({
          code: 'view.not_found',
          message: `View not found: ${query.viewId.toString()}`,
        })
      );
    }

    const resultView = projectViewForQuery(tableResult.value, viewResult.value);
    if (resultView.isErr()) return err(resultView.error);

    logger.debug('GetViewHandler.success');
    return ok(GetViewResult.create(resultView.value));
  }
}
