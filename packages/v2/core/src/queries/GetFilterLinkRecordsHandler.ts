import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry, type Result } from 'neverthrow';

import { RecordQueryPluginRunner } from '../application/services/RecordQueryPluginRunner';
import type { DomainError } from '../domain/shared/DomainError';
import { collectFilterLinkReferences } from '../domain/table/methods/viewFilterLinkReferences';
import { TableByIdSpec } from '../domain/table/specs/TableByIdSpec';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { RecordQueryOperationKind } from '../ports/RecordQueryPlugin';
import * as TableRecordQueryRepositoryPort from '../ports/TableRecordQueryRepository';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { GetFilterLinkRecordsQuery } from './GetFilterLinkRecordsQuery';
import {
  loadFilterLinkRecordGroups,
  type ViewFilterLinkRecordGroup,
} from './loadFilterLinkRecordGroups';
import { QueryHandler, type IQueryHandler } from './QueryHandler';

export class GetFilterLinkRecordsResult {
  private constructor(readonly groups: ReadonlyArray<ViewFilterLinkRecordGroup>) {}

  static create(groups: ReadonlyArray<ViewFilterLinkRecordGroup>): GetFilterLinkRecordsResult {
    return new GetFilterLinkRecordsResult(groups);
  }
}

@QueryHandler(GetFilterLinkRecordsQuery)
@injectable()
export class GetFilterLinkRecordsHandler implements IQueryHandler<
  GetFilterLinkRecordsQuery,
  GetFilterLinkRecordsResult
> {
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.tableRecordQueryRepository)
    private readonly tableRecordQueryRepository: TableRecordQueryRepositoryPort.ITableRecordQueryRepository,
    @inject(v2CoreTokens.recordQueryPluginRunner)
    private readonly recordQueryPluginRunner: RecordQueryPluginRunner
  ) {}

  async handle(
    context: IExecutionContext,
    query: GetFilterLinkRecordsQuery
  ): Promise<Result<GetFilterLinkRecordsResult, DomainError>> {
    const handler = this; // NOSONAR typescript:S7740 -- generator functions cannot be arrow functions, so `this` must be captured
    return safeTry<GetFilterLinkRecordsResult, DomainError>(async function* () {
      const table = yield* await handler.tableRepository.findOne(
        context,
        TableByIdSpec.create(query.tableId)
      );
      const execution = yield* await handler.recordQueryPluginRunner.prepare({
        kind: RecordQueryOperationKind.getByIds,
        executionContext: context,
        table,
        payload: { recordIds: [], projectionFieldIds: [] },
      });
      yield* await execution.guard();
      const references = query.filter ? collectFilterLinkReferences(table, query.filter) : [];
      const groups = yield* await loadFilterLinkRecordGroups(
        context,
        handler.tableRepository,
        handler.tableRecordQueryRepository,
        references,
        handler.recordQueryPluginRunner
      );
      return ok(GetFilterLinkRecordsResult.create(groups));
    });
  }
}
