import { inject, injectable } from '@teable/v2-di';
import { safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import { FieldDeleted } from '../../domain/table/events/FieldDeleted';
import type { IEventHandler } from '../../ports/EventHandler';
import type * as ExecutionContextPort from '../../ports/ExecutionContext';
import { RealtimeDocId } from '../../ports/RealtimeDocId';
import * as RealtimeEnginePort from '../../ports/RealtimeEngine';
import { v2CoreTokens } from '../../ports/tokens';
import { ProjectionHandler } from './Projection';

const fieldCollectionPrefix = 'fld';

@ProjectionHandler(FieldDeleted)
@injectable()
export class FieldDeletedRealtimeProjection implements IEventHandler<FieldDeleted> {
  constructor(
    @inject(v2CoreTokens.realtimeEngine)
    private readonly realtimeEngine: RealtimeEnginePort.IRealtimeEngine
  ) {}

  async handle(
    context: ExecutionContextPort.IExecutionContext,
    event: FieldDeleted
  ): Promise<Result<void, DomainError>> {
    const { realtimeEngine } = this;

    return safeTry(async function* () {
      const collection = `${fieldCollectionPrefix}_${event.tableId.toString()}`;
      const docId = yield* RealtimeDocId.fromParts(
        collection,
        event.fieldId.toString()
      ).safeUnwrap();

      return realtimeEngine.delete(context, docId);
    });
  }
}
