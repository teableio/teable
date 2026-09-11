import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { RecordQueryPluginRunner } from '../application/services/RecordQueryPluginRunner';
import { domainError, isNotFoundError, type DomainError } from '../domain/shared/DomainError';
import { andSpec } from '../domain/shared/specification/AndSpec';
import { RecordByIdsSpec } from '../domain/table/records/specs/RecordByIdsSpec';
import { TableByIdSpec } from '../domain/table/specs/TableByIdSpec';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { RecordQueryOperationKind } from '../ports/RecordQueryPlugin';
import * as TableCommentQueryRepositoryPort from '../ports/TableCommentQueryRepository';
import * as TableRecordQueryRepositoryPort from '../ports/TableRecordQueryRepository';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { GetTableCommentCountQuery } from './GetTableCommentCountQuery';
import { QueryHandler, type IQueryHandler } from './QueryHandler';

export class GetTableCommentCountResult {
  private constructor(
    readonly counts: ReadonlyArray<TableCommentQueryRepositoryPort.ITableCommentCount>
  ) {}

  static create(
    counts: ReadonlyArray<TableCommentQueryRepositoryPort.ITableCommentCount>
  ): GetTableCommentCountResult {
    return new GetTableCommentCountResult(counts);
  }
}

@QueryHandler(GetTableCommentCountQuery)
@injectable()
export class GetTableCommentCountHandler
  implements IQueryHandler<GetTableCommentCountQuery, GetTableCommentCountResult>
{
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.recordQueryPluginRunner)
    private readonly recordQueryPluginRunner: RecordQueryPluginRunner,
    @inject(v2CoreTokens.tableRecordQueryRepository)
    private readonly recordQueryRepository: TableRecordQueryRepositoryPort.ITableRecordQueryRepository,
    @inject(v2CoreTokens.tableCommentQueryRepository)
    private readonly tableCommentQueryRepository: TableCommentQueryRepositoryPort.ITableCommentQueryRepository
  ) {}

  async handle(
    context: IExecutionContext,
    query: GetTableCommentCountQuery
  ): Promise<Result<GetTableCommentCountResult, DomainError>> {
    const handler = this;
    return safeTry<GetTableCommentCountResult, DomainError>(async function* () {
      const table = yield* (
        await handler.tableRepository.findOne(context, TableByIdSpec.create(query.tableId))
      ).mapErr((error) =>
        isNotFoundError(error)
          ? domainError.notFound({ code: 'table.not_found', message: 'Table not found' })
          : error
      );
      let recordIds = query.recordIds.map((id) => id.toString());
      const execution = yield* await handler.recordQueryPluginRunner.prepare({
        kind: RecordQueryOperationKind.getByIds,
        executionContext: context,
        table,
        payload: { recordIds, projectionFieldIds: [] },
      });
      yield* await execution.guard();
      const scope = yield* execution.getScope();
      if (!recordIds.length) return ok(GetTableCommentCountResult.create([]));

      // Loaded IDs are not authorization. Restrict them to the current row scope,
      // without replaying the grid's view filters, search, grouping or pagination.
      if (scope?.recordSpec) {
        const spec = yield* andSpec(RecordByIdsSpec.create(query.recordIds), scope.recordSpec);
        const authorized = yield* await handler.recordQueryRepository.find(context, table, spec, {
          mode: 'stored',
          idsOnly: true,
          includeTotal: false,
          projectionFieldIds: [],
        });
        recordIds = authorized.records.map((record) => record.id);
      }

      const counts = yield* await handler.tableCommentQueryRepository.countByRecordIds(
        context,
        query.tableId,
        recordIds
      );
      return ok(GetTableCommentCountResult.create(counts));
    });
  }
}
