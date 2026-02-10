import type {
  IExecutionContext,
  IRealtimeEngine,
  RealtimeApplyChangeOptions,
  RealtimeChange,
  RealtimeDocId,
  DomainError,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import type { Result } from 'neverthrow';

import { BroadcastChannelRealtimeHub } from './BroadcastChannelRealtimeHub';
import { v2BroadcastChannelTokens } from './di/tokens';

@injectable()
export class BroadcastChannelRealtimeEngine implements IRealtimeEngine {
  constructor(
    @inject(v2BroadcastChannelTokens.hub)
    private readonly hub: BroadcastChannelRealtimeHub
  ) {}

  async ensure(
    _context: IExecutionContext,
    docId: RealtimeDocId,
    initial: unknown
  ): Promise<Result<void, DomainError>> {
    return this.hub.ensure(docId, initial);
  }

  async applyChange(
    _context: IExecutionContext,
    docId: RealtimeDocId,
    change: RealtimeChange | ReadonlyArray<RealtimeChange>,
    _options?: RealtimeApplyChangeOptions
  ): Promise<Result<void, DomainError>> {
    return this.hub.applyChange(docId, change);
  }

  async delete(
    _context: IExecutionContext,
    docId: RealtimeDocId
  ): Promise<Result<void, DomainError>> {
    return this.hub.remove(docId);
  }
}
