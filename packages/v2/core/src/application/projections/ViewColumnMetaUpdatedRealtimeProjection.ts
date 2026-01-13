import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import { ViewColumnMetaUpdated } from '../../domain/table/events/ViewColumnMetaUpdated';
import { Table } from '../../domain/table/Table';
import type { IEventHandler } from '../../ports/EventHandler';
import type * as ExecutionContextPort from '../../ports/ExecutionContext';
import * as TableMapperPort from '../../ports/mappers/TableMapper';
import { RealtimeDocId } from '../../ports/RealtimeDocId';
import * as RealtimeEnginePort from '../../ports/RealtimeEngine';
import * as TableRepositoryPort from '../../ports/TableRepository';
import { v2CoreTokens } from '../../ports/tokens';
import { ProjectionHandler } from './Projection';

const tableCollectionPrefix = 'tbl';

@ProjectionHandler(ViewColumnMetaUpdated)
@injectable()
export class ViewColumnMetaUpdatedRealtimeProjection
  implements IEventHandler<ViewColumnMetaUpdated>
{
  constructor(
    @inject(v2CoreTokens.realtimeEngine)
    private readonly realtimeEngine: RealtimeEnginePort.IRealtimeEngine,
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.tableMapper)
    private readonly tableMapper: TableMapperPort.ITableMapper
  ) {}

  async handle(
    context: ExecutionContextPort.IExecutionContext,
    event: ViewColumnMetaUpdated
  ): Promise<Result<void, DomainError>> {
    const { realtimeEngine, tableRepository, tableMapper } = this;

    return safeTry(async function* () {
      // Fetch table data from repository
      const spec = yield* Table.specs(event.baseId).byId(event.tableId).build().safeUnwrap();
      const table = yield* (await tableRepository.findOne(context, spec)).safeUnwrap();
      const snapshot = yield* tableMapper.toDTO(table).safeUnwrap();

      const viewIndex = snapshot.views.findIndex((view) => view.id === event.viewId.toString());
      if (viewIndex === -1) return ok(undefined);

      const viewDto = snapshot.views[viewIndex];

      const collection = `${tableCollectionPrefix}_${event.baseId.toString()}`;
      const docId = yield* RealtimeDocId.fromParts(
        collection,
        event.tableId.toString()
      ).safeUnwrap();

      // Ensure table document exists first (for tables created before realtime was enabled)
      yield* (await realtimeEngine.ensure(context, docId, snapshot)).safeUnwrap();

      // Apply incremental change to update view columnMeta
      return realtimeEngine.applyChange(context, docId, {
        type: 'set',
        path: ['views', viewIndex, 'columnMeta'],
        value: viewDto.columnMeta,
      });
    });
  }
}
