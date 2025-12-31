import { inject, injectable } from '@teable/v2-di';
import { err } from 'neverthrow';
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
    const collection = `${fieldCollectionPrefix}_${event.tableId.toString()}`;
    const docIdResult = RealtimeDocId.fromParts(collection, event.fieldId.toString());
    if (docIdResult.isErr()) return err(docIdResult.error);

    return this.realtimeEngine.delete(context, docIdResult.value);
  }
}
