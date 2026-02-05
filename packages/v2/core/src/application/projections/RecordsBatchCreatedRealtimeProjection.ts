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
import { ProjectionHandler } from './Projection';
import { buildRecordCollection, type ITableRecordRealtimeDTO } from './TableRecordRealtimeDTO';

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

    return safeTry(async function* () {
      const collection = buildRecordCollection(event.tableId.toString());

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

        yield* (await realtimeEngine.ensure(context, docId, snapshot)).safeUnwrap();
      }

      return ok(undefined);
    });
  }
}
