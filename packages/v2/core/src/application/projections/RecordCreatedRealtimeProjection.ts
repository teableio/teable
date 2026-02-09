import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import { RecordCreated } from '../../domain/table/events/RecordCreated';
import type { IEventHandler } from '../../ports/EventHandler';
import type * as ExecutionContextPort from '../../ports/ExecutionContext';
import { RealtimeDocId } from '../../ports/RealtimeDocId';
import * as RealtimeEnginePort from '../../ports/RealtimeEngine';
import { v2CoreTokens } from '../../ports/tokens';
import { ProjectionHandler } from './Projection';
import { buildRecordCollection, type ITableRecordRealtimeDTO } from './TableRecordRealtimeDTO';

@ProjectionHandler(RecordCreated)
@injectable()
export class RecordCreatedRealtimeProjection implements IEventHandler<RecordCreated> {
  constructor(
    @inject(v2CoreTokens.realtimeEngine)
    private readonly realtimeEngine: RealtimeEnginePort.IRealtimeEngine
  ) {}

  async handle(
    context: ExecutionContextPort.IExecutionContext,
    event: RecordCreated
  ): Promise<Result<void, DomainError>> {
    const { realtimeEngine } = this;

    return safeTry(async function* () {
      const collection = buildRecordCollection(event.tableId.toString());
      const docId = yield* RealtimeDocId.fromParts(
        collection,
        event.recordId.toString()
      ).safeUnwrap();

      // Convert fieldValues array to flat map
      const fields: Record<string, unknown> = {};
      for (const fieldValue of event.fieldValues) {
        fields[fieldValue.fieldId] = fieldValue.value;
      }

      const snapshot: ITableRecordRealtimeDTO = {
        id: event.recordId.toString(),
        fields,
      };

      yield* (await realtimeEngine.ensure(context, docId, snapshot)).safeUnwrap();

      return ok(undefined);
    });
  }
}
