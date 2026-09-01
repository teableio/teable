import { inject, injectable } from '@teable/v2-di';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, isNotFoundError, type DomainError } from '../domain/shared/DomainError';
import { Table } from '../domain/table/Table';
import type { IExecutionContext } from '../ports/ExecutionContext';
import * as LoggerPort from '../ports/Logger';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { ListViewsQuery } from './ListViewsQuery';
import { QueryHandler, type IQueryHandler } from './QueryHandler';
import { projectViewForQuery, type ViewQueryResultView } from './ViewQueryProjection';

export class ListViewsResult {
  private constructor(readonly views: ReadonlyArray<ViewQueryResultView>) {}

  static create(views: ReadonlyArray<ViewQueryResultView>): ListViewsResult {
    return new ListViewsResult(views);
  }
}

@QueryHandler(ListViewsQuery)
@injectable()
export class ListViewsHandler implements IQueryHandler<ListViewsQuery, ListViewsResult> {
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.logger)
    private readonly logger: LoggerPort.ILogger
  ) {}

  async handle(
    context: IExecutionContext,
    query: ListViewsQuery
  ): Promise<Result<ListViewsResult, DomainError>> {
    const logger = this.logger.scope('query', { name: ListViewsHandler.name }).child({
      tableId: query.tableId.toString(),
    });
    logger.debug('ListViewsHandler.start', { actorId: context.actorId.toString() });

    if (query.viewIds?.length === 0) {
      return ok(ListViewsResult.create([]));
    }

    const specBuilder = Table.specs().byId(query.tableId);
    if (query.viewIds) specBuilder.withViewIds(query.viewIds);
    const specResult = specBuilder.build();
    if (specResult.isErr()) return err(specResult.error);

    const tableResult = await this.tableRepository.findOne(context, specResult.value);
    if (tableResult.isErr()) {
      if (isNotFoundError(tableResult.error)) {
        return err(domainError.notFound({ code: 'table.not_found', message: 'Table not found' }));
      }
      return err(tableResult.error);
    }

    const projectedViewIds = query.viewIds
      ? new Set(query.viewIds.map((viewId) => viewId.toString()))
      : undefined;
    const views: ViewQueryResultView[] = [];
    for (const view of tableResult.value.views()) {
      if (projectedViewIds && !projectedViewIds.has(view.id().toString())) continue;
      const viewResult = projectViewForQuery(tableResult.value, view);
      if (viewResult.isErr()) return err(viewResult.error);
      views.push(viewResult.value);
    }

    logger.debug('ListViewsHandler.success', { count: views.length });
    return ok(ListViewsResult.create(views));
  }
}
