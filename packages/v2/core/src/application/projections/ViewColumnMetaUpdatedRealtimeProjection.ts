import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import { domainError } from '../../domain/shared/DomainError';
import { ViewColumnMetaUpdated } from '../../domain/table/events/ViewColumnMetaUpdated';
import type { IEventHandler } from '../../ports/EventHandler';
import type * as ExecutionContextPort from '../../ports/ExecutionContext';
import { RealtimeDocId } from '../../ports/RealtimeDocId';
import * as RealtimeEnginePort from '../../ports/RealtimeEngine';
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
    private readonly realtimeEngine: RealtimeEnginePort.IRealtimeEngine
  ) {}

  async handle(
    context: ExecutionContextPort.IExecutionContext,
    event: ViewColumnMetaUpdated
  ): Promise<Result<void, DomainError>> {
    const { realtimeEngine } = this;
    const snapshot = event.tableSnapshot;

    if (!snapshot) {
      return err(
        domainError.unexpected({ message: 'ViewColumnMetaUpdated event missing tableSnapshot' })
      );
    }

    return safeTry(async function* () {
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
