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
import { GetRecordByIdQuery } from './GetRecordByIdQuery';
import { QueryHandler, type IQueryHandler } from './QueryHandler';

export class GetRecordByIdResult {
  private constructor(readonly record: TableRecordReadModel) {}

  static create(record: TableRecordReadModel): GetRecordByIdResult {
    return new GetRecordByIdResult(record);
  }
}

@QueryHandler(GetRecordByIdQuery)
@injectable()
export class GetRecordByIdHandler
  implements IQueryHandler<GetRecordByIdQuery, GetRecordByIdResult>
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
    query: GetRecordByIdQuery
  ): Promise<Result<GetRecordByIdResult, DomainError>> {
    const logger = this.logger.scope('query', { name: GetRecordByIdHandler.name }).child({
      tableId: query.tableId.toString(),
      recordId: query.recordId.toString(),
    });
    logger.debug('GetRecordByIdHandler.start', { actorId: context.actorId.toString() });

    return safeTry<GetRecordByIdResult, DomainError>(
      async function* (this: GetRecordByIdHandler) {
        // 1. Load table
        const tableSpec = TableByIdSpec.create(query.tableId);
        const table = yield* (await this.tableRepository.findOne(context, tableSpec)).mapErr(
          (error: DomainError) =>
            isNotFoundError(error)
              ? domainError.notFound({
                  code: 'table.not_found',
                  message: 'Table not found',
                  details: { tableId: query.tableId.toString() },
                })
              : error
        );

        // 2. Query record by ID
        const record = yield* (
          await this.tableRecordQueryRepository.findOne(context, table, query.recordId, {
            // !!!IMPORTANT: Get record by ID is always using stored values
            // never change this to 'computed'
            mode: 'stored',
          })
        ).mapErr((error: DomainError) =>
          isNotFoundError(error)
            ? domainError.notFound({ code: 'record.not_found', message: 'Record not found' })
            : error
        );

        logger.debug('GetRecordByIdHandler.success');

        return ok(GetRecordByIdResult.create(record));
      }.bind(this)
    );
  }
}
