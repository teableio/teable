import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import { RecordsBatchUpdated } from '../../domain/table/events/RecordsBatchUpdated';
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

@ProjectionHandler(RecordsBatchUpdated)
@injectable()
export class RecordsBatchUpdatedRealtimeProjection implements IEventHandler<RecordsBatchUpdated> {
  constructor(
    @inject(v2CoreTokens.realtimeEngine)
    private readonly realtimeEngine: RealtimeEnginePort.IRealtimeEngine
  ) {}

  async handle(
    context: ExecutionContextPort.IExecutionContext,
    event: RecordsBatchUpdated
  ): Promise<Result<void, DomainError>> {
    const { realtimeEngine } = this;
    const orchestration = event.orchestration;
    const totalRecordCount = orchestration?.totalRecordCount ?? event.updates.length;
    const skipRealtime = shouldSkipRealtimeBatchMutation(totalRecordCount, orchestration);
    const fanoutAttributes = buildRealtimeFanoutSpanAttributes({
      totalRecordCount,
      chunkRecordCount: event.updates.length,
      fanoutCount: event.updates.length,
      skipRealtime,
      orchestration,
    });

    // Large batch updates are better served by a single table-level refresh
    // trigger; applying per-record realtime ops multiplies memory pressure and
    // negates the gains from the streaming paste path.
    if (skipRealtime) {
      await withRealtimeFanoutSpan(
        context,
        teableSpanName('teable.RecordsBatchUpdatedRealtimeProjection.realtimeFanout'),
        fanoutAttributes,
        async () => ok(undefined)
      );
      return ok(undefined);
    }

    return safeTry(async function* () {
      const collection = buildRecordCollection(event.tableId.toString());

      const tasksByRecord = new Map<string, () => Promise<Result<void, DomainError>>>();
      const docIds = new Map<string, RealtimeDocId>();

      for (const update of event.updates) {
        let docId = docIds.get(update.recordId);
        if (!docId) {
          docId = yield* RealtimeDocId.fromParts(collection, update.recordId).safeUnwrap();
          docIds.set(update.recordId, docId);
        }

        // For updates, only send UPDATE ops (not CREATE).
        // The record already exists in the client, so we should NOT call ensure()
        // which would broadcast a create op with empty fields and overwrite client data.
        const batchedChanges = update.changes.map((change) => ({
          type: 'set' as const,
          path: ['fields', change.fieldId],
          value: change.newValue,
          ...(change.oldValue === undefined ? {} : { oldValue: change.oldValue }),
        }));

        if (batchedChanges.length === 0) continue;

        const previous = tasksByRecord.get(update.recordId);
        const next = async () => {
          if (previous) {
            const previousResult = await previous();
            if (previousResult.isErr()) return previousResult;
          }

          return realtimeEngine.applyChange(context, docId, batchedChanges, {
            version: update.oldVersion,
          });
        };
        tasksByRecord.set(update.recordId, next);
      }

      yield* (
        await withRealtimeFanoutSpan(
          context,
          teableSpanName('teable.RecordsBatchUpdatedRealtimeProjection.realtimeFanout'),
          {
            ...fanoutAttributes,
            'teable.fanout_count': tasksByRecord.size,
          },
          async () => {
            for (const result of await runRealtimeTasks(Array.from(tasksByRecord.values()))) {
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
