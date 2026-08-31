import { inject, injectable } from '@teable/v2-di';
import { err, ok, type Result } from 'neverthrow';

import { domainError, isNotFoundError, type DomainError } from '../domain/shared/DomainError';
import { Table } from '../domain/table/Table';
import type { IExecutionContext } from '../ports/ExecutionContext';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { GetViewSnapshotsQuery } from './GetViewSnapshotsQuery';
import { QueryHandler, type IQueryHandler } from './QueryHandler';
import { projectViewForQuery, type ViewQueryResultView } from './ViewQueryProjection';

export type ViewSnapshotQueryItem = {
  readonly id: string;
  readonly version: number;
  readonly view: ViewQueryResultView;
};

export class GetViewSnapshotsResult {
  private constructor(readonly snapshots: ReadonlyArray<ViewSnapshotQueryItem>) {}

  static create(snapshots: ReadonlyArray<ViewSnapshotQueryItem>): GetViewSnapshotsResult {
    return new GetViewSnapshotsResult(snapshots);
  }
}

@QueryHandler(GetViewSnapshotsQuery)
@injectable()
export class GetViewSnapshotsHandler
  implements IQueryHandler<GetViewSnapshotsQuery, GetViewSnapshotsResult>
{
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository
  ) {}

  async handle(
    context: IExecutionContext,
    query: GetViewSnapshotsQuery
  ): Promise<Result<GetViewSnapshotsResult, DomainError>> {
    if (query.viewIds.length === 0) {
      return ok(GetViewSnapshotsResult.create([]));
    }

    const specResult = Table.specs().byId(query.tableId).withViewIds(query.viewIds).build();
    if (specResult.isErr()) return err(specResult.error);

    const tableResult = await this.tableRepository.findOne(context, specResult.value);
    if (tableResult.isErr()) {
      if (isNotFoundError(tableResult.error)) {
        return err(domainError.notFound({ code: 'table.not_found', message: 'Table not found' }));
      }
      return err(tableResult.error);
    }

    const viewById = new Map(tableResult.value.views().map((view) => [view.id().toString(), view]));
    const requestedIds = query.viewIds.map((viewId) => viewId.toString());
    const missingIds = requestedIds.filter((viewId) => !viewById.has(viewId));
    if (missingIds.length > 0) {
      return err(
        domainError.notFound({
          code: 'view.not_found',
          message: `View not found: ${missingIds.join(', ')}`,
        })
      );
    }
    if (new Set(requestedIds).size !== requestedIds.length) {
      const duplicateIds = requestedIds.filter((viewId, index) =>
        requestedIds.includes(viewId, index + 1)
      );
      return err(
        domainError.notFound({
          code: 'view.not_found',
          message: `Duplicate view ids requested: ${[...new Set(duplicateIds)].join(', ')}`,
        })
      );
    }

    const snapshots: ViewSnapshotQueryItem[] = [];
    for (const viewId of requestedIds) {
      const view = viewById.get(viewId);
      if (!view) {
        return err(
          domainError.notFound({
            code: 'view.not_found',
            message: `View not found: ${viewId}`,
          })
        );
      }
      const versionResult = view.version();
      if (versionResult.isErr()) return err(versionResult.error);
      const projectionResult = projectViewForQuery(tableResult.value, view);
      if (projectionResult.isErr()) return err(projectionResult.error);
      snapshots.push({
        id: viewId,
        version: versionResult.value.toNumber(),
        view: projectionResult.value,
      });
    }

    return ok(GetViewSnapshotsResult.create(snapshots));
  }
}
