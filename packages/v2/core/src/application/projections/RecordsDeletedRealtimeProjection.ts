import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import { RecordsDeleted } from '../../domain/table/events/RecordsDeleted';
import type { IEventHandler } from '../../ports/EventHandler';
import type * as ExecutionContextPort from '../../ports/ExecutionContext';
import { RealtimeDocId } from '../../ports/RealtimeDocId';
import * as RealtimeEnginePort from '../../ports/RealtimeEngine';
import { v2CoreTokens } from '../../ports/tokens';
import { teableSpanName } from '../../ports/Tracer';
import { shouldSkipRealtimeBatchMutation } from './BatchRecordRefreshPolicy';
import { ProjectionHandler } from './Projection';
import { runRealtimeTasks } from './runRealtimeTasks';
import { buildRecordCollection } from './TableRecordRealtimeDTO';
import { buildRealtimeFanoutSpanAttributes, withRealtimeFanoutSpan } from './traceRealtimeFanout';

@ProjectionHandler(RecordsDeleted)
@injectable()
export class RecordsDeletedRealtimeProjection implements IEventHandler<RecordsDeleted> {
  constructor(
    @inject(v2CoreTokens.realtimeEngine)
    private readonly realtimeEngine: RealtimeEnginePort.IRealtimeEngine
  ) {}

  async handle(
    context: ExecutionContextPort.IExecutionContext,
    event: RecordsDeleted
  ): Promise<Result<void, DomainError>> {
    const { realtimeEngine } = this;
    const orchestration = event.orchestration;
    const totalRecordCount = orchestration?.totalRecordCount ?? event.recordIds.length;
    const fanoutAttributes = buildRealtimeFanoutSpanAttributes({
      totalRecordCount,
      chunkRecordCount: event.recordIds.length,
      fanoutCount: event.recordIds.length,
      skipRealtime: shouldSkipRealtimeBatchMutation(totalRecordCount, orchestration),
      orchestration,
    });

    // Large batch deletes are better handled by the next table refresh path.
    // Per-record ShareDB delete fan-out multiplies Redis pressure without
    // providing meaningful UX value at this scale.
    if (fanoutAttributes['teable.skip_realtime']) {
      await withRealtimeFanoutSpan(
        context,
        teableSpanName('teable.RecordsDeletedRealtimeProjection.realtimeFanout'),
        fanoutAttributes,
        async () => ok(undefined)
      );
      return ok(undefined);
    }

    return safeTry(async function* () {
      const collection = buildRecordCollection(event.tableId.toString());
      const deleteTasks: Array<() => Promise<Result<void, DomainError>>> = [];

      for (const recordId of event.recordIds) {
        const docId = yield* RealtimeDocId.fromParts(collection, recordId.toString()).safeUnwrap();
        deleteTasks.push(() => realtimeEngine.delete(context, docId));
      }

      yield* (
        await withRealtimeFanoutSpan(
          context,
          teableSpanName('teable.RecordsDeletedRealtimeProjection.realtimeFanout'),
          fanoutAttributes,
          async () => {
            for (const result of await runRealtimeTasks(deleteTasks)) {
              result._unsafeUnwrap();
            }

            return ok(undefined);
          }
        )
      ).safeUnwrap();

      return ok(undefined);
    });
  }
}
