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
import { buildRecordCollection } from './TableRecordRealtimeDTO';

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

      const tasksByRecord = new Map<string, Promise<Result<void, DomainError>>>();
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
        }));

        if (batchedChanges.length === 0) continue;

        const previous = tasksByRecord.get(update.recordId) ?? Promise.resolve(ok(undefined));
        const next = previous.then(async (previousResult) => {
          if (previousResult.isErr()) return previousResult;
          return realtimeEngine.applyChange(context, docId, batchedChanges, {
            version: update.oldVersion,
          });
        });
        tasksByRecord.set(update.recordId, next);
      }

      for (const result of await Promise.all(tasksByRecord.values())) {
        yield* result.safeUnwrap();
      }

      return ok(undefined);
    });
  }
}
