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
import { ProjectionHandler } from './Projection';
import { buildRecordCollection } from './TableRecordRealtimeDTO';

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

    return safeTry(async function* () {
      const collection = buildRecordCollection(event.tableId.toString());

      for (const recordId of event.recordIds) {
        const docId = yield* RealtimeDocId.fromParts(collection, recordId.toString()).safeUnwrap();

        yield* (await realtimeEngine.delete(context, docId)).safeUnwrap();
      }

      return ok(undefined);
    });
  }
}
