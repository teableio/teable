import { inject, injectable } from '@teable/v2-di';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, isNotFoundError, type DomainError } from '../domain/shared/DomainError';
import { collectFilterLinkReferences } from '../domain/table/methods/viewFilterLinkReferences';
import { Table } from '../domain/table/Table';
import type { IExecutionContext } from '../ports/ExecutionContext';
import * as LoggerPort from '../ports/Logger';
import * as TableRecordQueryRepositoryPort from '../ports/TableRecordQueryRepository';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { GetFieldFilterLinkRecordsQuery } from './GetFieldFilterLinkRecordsQuery';
import { GetViewFilterLinkRecordsResult } from './GetViewFilterLinkRecordsHandler';
import { loadFilterLinkRecordGroups } from './loadFilterLinkRecordGroups';
import { QueryHandler, type IQueryHandler } from './QueryHandler';

@QueryHandler(GetFieldFilterLinkRecordsQuery)
@injectable()
export class GetFieldFilterLinkRecordsHandler
  implements IQueryHandler<GetFieldFilterLinkRecordsQuery, GetViewFilterLinkRecordsResult>
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
    query: GetFieldFilterLinkRecordsQuery
  ): Promise<Result<GetViewFilterLinkRecordsResult, DomainError>> {
    const logger = this.logger
      .scope('query', {
        name: GetFieldFilterLinkRecordsHandler.name,
      })
      .child({
        tableId: query.tableId.toString(),
        fieldId: query.fieldId.toString(),
      });
    logger.debug('GetFieldFilterLinkRecordsHandler.start', {
      actorId: context.actorId.toString(),
    });

    const sourceSpecResult = Table.specs().byId(query.tableId).build();
    if (sourceSpecResult.isErr()) return err(sourceSpecResult.error);

    const sourceTableResult = await this.tableRepository.findOne(context, sourceSpecResult.value);
    if (sourceTableResult.isErr()) {
      if (isNotFoundError(sourceTableResult.error)) {
        return err(
          domainError.notFound({
            code: 'table.not_found',
            message: 'Table not found',
            details: { tableId: query.tableId.toString() },
          })
        );
      }
      return err(sourceTableResult.error);
    }

    const scopeResult = sourceTableResult.value.fieldFilterLinkScope(query.fieldId);
    if (scopeResult.isErr()) return err(scopeResult.error);
    if (!scopeResult.value) {
      logger.debug('GetFieldFilterLinkRecordsHandler.success', { groupCount: 0 });
      return ok(GetViewFilterLinkRecordsResult.create([]));
    }

    const foreignSpecResult = Table.specs().byId(scopeResult.value.foreignTableId).build();
    if (foreignSpecResult.isErr()) return err(foreignSpecResult.error);

    const foreignTableResult = await this.tableRepository.findOne(context, foreignSpecResult.value);
    if (foreignTableResult.isErr()) return err(foreignTableResult.error);

    const references = collectFilterLinkReferences(
      foreignTableResult.value,
      scopeResult.value.filter
    );
    const groupsResult = await loadFilterLinkRecordGroups(
      context,
      this.tableRepository,
      this.tableRecordQueryRepository,
      references
    );
    if (groupsResult.isErr()) return err(groupsResult.error);

    logger.debug('GetFieldFilterLinkRecordsHandler.success', {
      groupCount: groupsResult.value.length,
    });
    return ok(GetViewFilterLinkRecordsResult.create(groupsResult.value));
  }
}
