import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import { RecordsBatchCreated } from '../../domain/table/events/RecordsBatchCreated';
import type { IEventHandler } from '../../ports/EventHandler';
import type * as ExecutionContextPort from '../../ports/ExecutionContext';
import { RealtimeDocId } from '../../ports/RealtimeDocId';
import * as RealtimeEnginePort from '../../ports/RealtimeEngine';
import { v2CoreTokens } from '../../ports/tokens';
import { teableSpanName } from '../../ports/Tracer';
import { shouldSkipRealtimeBatchMutation } from './BatchRecordRefreshPolicy';
import { ProjectionHandler } from './Projection';
import { runRealtimeTasks } from './runRealtimeTasks';
import { buildRecordCollection, type ITableRecordRealtimeDTO } from './TableRecordRealtimeDTO';
import { buildRealtimeFanoutSpanAttributes, withRealtimeFanoutSpan } from './traceRealtimeFanout';

@ProjectionHandler(RecordsBatchCreated)
@injectable()
export class RecordsBatchCreatedRealtimeProjection implements IEventHandler<RecordsBatchCreated> {
  constructor(
    @inject(v2CoreTokens.realtimeEngine)
    private readonly realtimeEngine: RealtimeEnginePort.IRealtimeEngine
  ) {}

  async handle(
    context: ExecutionContextPort.IExecutionContext,
    event: RecordsBatchCreated
  ): Promise<Result<void, DomainError>> {
    const { realtimeEngine } = this;
    const orchestration = event.orchestration;
    const totalRecordCount = orchestration?.totalRecordCount ?? event.records.length;
    const fanoutCount = event.records.length;
    const skipRealtime = shouldSkipRealtimeBatchMutation(totalRecordCount, orchestration);
    const fanoutAttributes = buildRealtimeFanoutSpanAttributes({
      totalRecordCount,
      chunkRecordCount: event.records.length,
      fanoutCount,
      skipRealtime,
      orchestration,
    });

    if (skipRealtime) {
      await withRealtimeFanoutSpan(
        context,
        teableSpanName('teable.RecordsBatchCreatedRealtimeProjection.realtimeFanout'),
        fanoutAttributes,
        async () => ok(undefined)
      );
      return ok(undefined);
    }

    return safeTry(async function* () {
      const collection = buildRecordCollection(event.tableId.toString());
      const tasks: Array<() => Promise<Result<void, DomainError>>> = [];

      for (const record of event.records) {
        const docId = yield* RealtimeDocId.fromParts(collection, record.recordId).safeUnwrap();

        // Convert fields array to flat map
        const fields: Record<string, unknown> = {};
        for (const fieldValue of record.fields) {
          fields[fieldValue.fieldId] = fieldValue.value;
        }

        const snapshot: ITableRecordRealtimeDTO = {
          id: record.recordId,
          fields,
        };

        tasks.push(() => realtimeEngine.ensure(context, docId, snapshot));
      }

      yield* (
        await withRealtimeFanoutSpan(
          context,
          teableSpanName('teable.RecordsBatchCreatedRealtimeProjection.realtimeFanout'),
          fanoutAttributes,
          async () => {
            for (const result of await runRealtimeTasks(tasks)) {
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
