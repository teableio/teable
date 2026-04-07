import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import { RecordReordered } from '../../domain/table/events/RecordReordered';
import type { IEventHandler } from '../../ports/EventHandler';
import type * as ExecutionContextPort from '../../ports/ExecutionContext';
import { RealtimeDocId } from '../../ports/RealtimeDocId';
import * as RealtimeEnginePort from '../../ports/RealtimeEngine';
import { v2CoreTokens } from '../../ports/tokens';
import { ProjectionHandler } from './Projection';
import { runRealtimeTasks } from './runRealtimeTasks';
import { buildRecordCollection } from './TableRecordRealtimeDTO';

@ProjectionHandler(RecordReordered)
@injectable()
export class RecordReorderedRealtimeProjection implements IEventHandler<RecordReordered> {
  constructor(
    @inject(v2CoreTokens.realtimeEngine)
    private readonly realtimeEngine: RealtimeEnginePort.IRealtimeEngine
  ) {}

  async handle(
    context: ExecutionContextPort.IExecutionContext,
    event: RecordReordered
  ): Promise<Result<void, DomainError>> {
    const { realtimeEngine } = this;

    return safeTry(async function* () {
      const collection = buildRecordCollection(event.tableId.toString());
      const rowOrderColumnName = event.viewId.toRowOrderColumnName();
      const tasks: Array<() => Promise<Result<void, DomainError>>> = [];

      for (const recordId of event.recordIds) {
        const recordIdString = recordId.toString();
        const orderValue = event.ordersByRecordId[recordIdString];
        const previousOrderValue = event.previousOrdersByRecordId[recordIdString];
        if (orderValue === undefined) {
          continue;
        }

        const docId = yield* RealtimeDocId.fromParts(collection, recordIdString).safeUnwrap();
        tasks.push(() =>
          realtimeEngine.applyChange(context, docId, {
            type: 'set',
            path: ['fields', rowOrderColumnName],
            value: orderValue,
            ...(previousOrderValue === undefined ? {} : { oldValue: previousOrderValue }),
          })
        );
      }

      for (const result of await runRealtimeTasks(tasks)) {
        yield* result.safeUnwrap();
      }

      return ok(undefined);
    });
  }
}
