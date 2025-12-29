import type { Result } from 'neverthrow';

import type { IExecutionContext } from './ExecutionContext';
import type { RealtimeChange } from './RealtimeChange';
import type { RealtimeDocId } from './RealtimeDocId';

export interface IRealtimeEngine {
  ensure(
    context: IExecutionContext,
    docId: RealtimeDocId,
    initial: unknown
  ): Promise<Result<void, string>>;

  applyChange(
    context: IExecutionContext,
    docId: RealtimeDocId,
    change: RealtimeChange
  ): Promise<Result<void, string>>;
}
