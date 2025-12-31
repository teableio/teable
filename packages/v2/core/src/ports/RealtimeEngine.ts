import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { IExecutionContext } from './ExecutionContext';
import type { RealtimeChange } from './RealtimeChange';
import type { RealtimeDocId } from './RealtimeDocId';

export interface IRealtimeEngine {
  ensure(
    context: IExecutionContext,
    docId: RealtimeDocId,
    initial: unknown
  ): Promise<Result<void, DomainError>>;

  applyChange(
    context: IExecutionContext,
    docId: RealtimeDocId,
    change: RealtimeChange
  ): Promise<Result<void, DomainError>>;

  delete(context: IExecutionContext, docId: RealtimeDocId): Promise<Result<void, DomainError>>;
}
