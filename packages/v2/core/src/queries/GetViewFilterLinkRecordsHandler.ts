import { inject, injectable } from '@teable/v2-di';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, isNotFoundError, type DomainError } from '../domain/shared/DomainError';
import type { IExecutionContext } from '../ports/ExecutionContext';
import * as LoggerPort from '../ports/Logger';
import * as TableRecordQueryRepositoryPort from '../ports/TableRecordQueryRepository';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { Table } from '../domain/table/Table';
import { GetViewFilterLinkRecordsQuery } from './GetViewFilterLinkRecordsQuery';
import {
  loadFilterLinkRecordGroups,
  type ViewFilterLinkRecord,
  type ViewFilterLinkRecordGroup,
} from './loadFilterLinkRecordGroups';
import { QueryHandler, type IQueryHandler } from './QueryHandler';

export type { ViewFilterLinkRecord, ViewFilterLinkRecordGroup };

export class GetViewFilterLinkRecordsResult {
  private constructor(readonly groups: ReadonlyArray<ViewFilterLinkRecordGroup>) {}

  static create(groups: ReadonlyArray<ViewFilterLinkRecordGroup>): GetViewFilterLinkRecordsResult {
    return new GetViewFilterLinkRecordsResult(groups);
  }
}

@QueryHandler(GetViewFilterLinkRecordsQuery)
@injectable()
export class GetViewFilterLinkRecordsHandler
  implements IQueryHandler<GetViewFilterLinkRecordsQuery, GetViewFilterLinkRecordsResult>
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
    query: GetViewFilterLinkRecordsQuery
  ): Promise<Result<GetViewFilterLinkRecordsResult, DomainError>> {
    const logger = this.logger
      .scope('query', {
        name: GetViewFilterLinkRecordsHandler.name,
      })
      .child({
        tableId: query.tableId.toString(),
        viewId: query.viewId.toString(),
      });
    logger.debug('GetViewFilterLinkRecordsHandler.start', {
      actorId: context.actorId.toString(),
    });

    const sourceSpecResult = Table.specs().byId(query.tableId).withViewId(query.viewId).build();
    if (sourceSpecResult.isErr()) return err(sourceSpecResult.error);

    const sourceTableResult = await this.tableRepository.findOne(context, sourceSpecResult.value);
    if (sourceTableResult.isErr()) {
      if (isNotFoundError(sourceTableResult.error)) {
        return err(
          domainError.notFound({
            code: 'view.not_found',
            message: `View not found: ${query.viewId.toString()}`,
          })
        );
      }
      return err(sourceTableResult.error);
    }

    const referencesResult = sourceTableResult.value.viewFilterLinkReferences(query.viewId);
    if (referencesResult.isErr()) return err(referencesResult.error);

    const groupsResult = await loadFilterLinkRecordGroups(
      context,
      this.tableRepository,
      this.tableRecordQueryRepository,
      referencesResult.value
    );
    if (groupsResult.isErr()) return err(groupsResult.error);

    logger.debug('GetViewFilterLinkRecordsHandler.success', {
      groupCount: groupsResult.value.length,
    });
    return ok(GetViewFilterLinkRecordsResult.create(groupsResult.value));
  }
}
