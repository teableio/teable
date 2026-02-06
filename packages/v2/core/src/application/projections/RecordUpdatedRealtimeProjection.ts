import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import { RecordUpdated } from '../../domain/table/events/RecordUpdated';
import type { IEventHandler } from '../../ports/EventHandler';
import type * as ExecutionContextPort from '../../ports/ExecutionContext';
import { RealtimeDocId } from '../../ports/RealtimeDocId';
import * as RealtimeEnginePort from '../../ports/RealtimeEngine';
import { v2CoreTokens } from '../../ports/tokens';
import { ProjectionHandler } from './Projection';
import { buildRecordCollection } from './TableRecordRealtimeDTO';

@ProjectionHandler(RecordUpdated)
@injectable()
export class RecordUpdatedRealtimeProjection implements IEventHandler<RecordUpdated> {
  constructor(
    @inject(v2CoreTokens.realtimeEngine)
    private readonly realtimeEngine: RealtimeEnginePort.IRealtimeEngine
  ) {}

  async handle(
    context: ExecutionContextPort.IExecutionContext,
    event: RecordUpdated
  ): Promise<Result<void, DomainError>> {
    const { realtimeEngine } = this;

    return safeTry(async function* () {
      const collection = buildRecordCollection(event.tableId.toString());
      const docId = yield* RealtimeDocId.fromParts(
        collection,
        event.recordId.toString()
      ).safeUnwrap();

      // For updates, only send UPDATE ops (not CREATE).
      // The record already exists in the client, so we should NOT call ensure()
      // which would broadcast a create op with empty fields and overwrite client data.
      for (const change of event.changes) {
        yield* (
          await realtimeEngine.applyChange(
            context,
            docId,
            {
              type: 'set',
              path: ['fields', change.fieldId],
              value: change.newValue,
            },
            { version: event.oldVersion }
          )
        ).safeUnwrap();
      }

      return ok(undefined);
    });
  }
}
