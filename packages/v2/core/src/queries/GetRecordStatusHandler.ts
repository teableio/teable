import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { isNotFoundError, type DomainError } from '../domain/shared/DomainError';
import type { IExecutionContext } from '../ports/ExecutionContext';
import * as LoggerPort from '../ports/Logger';
import { ITableRecordQueryRepository } from '../ports/TableRecordQueryRepository';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { GetRecordByIdHandler } from './GetRecordByIdHandler';
import { GetRecordByIdQuery } from './GetRecordByIdQuery';
import { GetRecordStatusQuery } from './GetRecordStatusQuery';
import { ListTableRecordsHandler } from './ListTableRecordsHandler';
import { ListTableRecordsQuery } from './ListTableRecordsQuery';
import { QueryHandler, type IQueryHandler } from './QueryHandler';

export class GetRecordStatusResult {
  private constructor(
    readonly isDeleted: boolean,
    readonly isVisible: boolean
  ) {}

  static create(isDeleted: boolean, isVisible: boolean): GetRecordStatusResult {
    return new GetRecordStatusResult(isDeleted, isVisible);
  }
}

@QueryHandler(GetRecordStatusQuery)
@injectable()
export class GetRecordStatusHandler
  implements IQueryHandler<GetRecordStatusQuery, GetRecordStatusResult>
{
  private readonly getRecordByIdHandler: GetRecordByIdHandler;
  private readonly listTableRecordsHandler: ListTableRecordsHandler;

  constructor(
    @inject(v2CoreTokens.tableRepository)
    tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.tableRecordQueryRepository)
    tableRecordQueryRepository: ITableRecordQueryRepository,
    @inject(v2CoreTokens.logger)
    logger: LoggerPort.ILogger
  ) {
    this.getRecordByIdHandler = new GetRecordByIdHandler(
      tableRepository,
      tableRecordQueryRepository,
      logger
    );
    this.listTableRecordsHandler = new ListTableRecordsHandler(
      tableRepository,
      tableRecordQueryRepository,
      logger
    );
  }

  async handle(
    context: IExecutionContext,
    query: GetRecordStatusQuery
  ): Promise<Result<GetRecordStatusResult, DomainError>> {
    return safeTry<GetRecordStatusResult, DomainError>(
      async function* (this: GetRecordStatusHandler) {
        const byIdQuery = yield* GetRecordByIdQuery.create({
          tableId: query.tableId.toString(),
          recordId: query.recordId.toString(),
        });
        const byIdResult = await this.getRecordByIdHandler.handle(context, byIdQuery);
        if (byIdResult.isErr()) {
          if (isNotFoundError(byIdResult.error) && byIdResult.error.code === 'record.not_found') {
            return ok(GetRecordStatusResult.create(true, false));
          }
          return err(byIdResult.error);
        }

        const listQuery = yield* ListTableRecordsQuery.create(
          {
            tableId: query.tableId.toString(),
            filter: query.filter,
            sort: query.sort,
            groupBy: query.groupBy,
            search: query.search,
            filterLinkCellSelected: query.filterLinkCellSelected,
            filterLinkCellCandidate: query.filterLinkCellCandidate,
            selectedRecordIds: query.selectedRecordIds,
            viewId: query.viewId,
            ignoreViewQuery: query.ignoreViewQuery,
            limit: query.limit,
            offset: query.offset,
            fieldKeyType: query.fieldKeyType,
            projection: [],
            includeTotal: false,
          },
          {
            idsOnly: true,
            queryScope: query.queryScope,
            table: query.table,
          }
        );
        const listResult = yield* await this.listTableRecordsHandler.handle(context, listQuery);
        const isVisible = listResult.records.some(
          (record) => record.id === query.recordId.toString()
        );
        return ok(GetRecordStatusResult.create(false, isVisible));
      }.bind(this)
    );
  }
}
