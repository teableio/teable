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
import { ProjectionHandler } from './Projection';
import { buildRecordCollection, type ITableRecordRealtimeDTO } from './TableRecordRealtimeDTO';

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

    return safeTry(async function* () {
      const collection = buildRecordCollection(event.tableId.toString());

      for (const update of event.updates) {
        const docId = yield* RealtimeDocId.fromParts(collection, update.recordId).safeUnwrap();

        // Build initial snapshot from changes
        const fields: Record<string, unknown> = {};
        for (const change of update.changes) {
          fields[change.fieldId] = change.newValue;
        }

        const snapshot: ITableRecordRealtimeDTO = {
          id: update.recordId,
          tableId: event.tableId.toString(),
          fields,
        };

        // Ensure document exists (handles historical records)
        yield* (await realtimeEngine.ensure(context, docId, snapshot)).safeUnwrap();

        // Apply incremental changes for each field
        for (const change of update.changes) {
          yield* (
            await realtimeEngine.applyChange(context, docId, {
              type: 'set',
              path: ['fields', change.fieldId],
              value: change.newValue,
            })
          ).safeUnwrap();
        }
      }

      return ok(undefined);
    });
  }
}
