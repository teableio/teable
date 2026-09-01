import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { IExecutionContext } from './ExecutionContext';
import type { RealtimeChange } from './RealtimeChange';
import type { RealtimeDocId } from './RealtimeDocId';

export type RealtimeApplyChangeOptions = {
  /**
   * The document version before this change.
   * Used by ShareDB to order operations correctly.
   */
  version?: number;
};

export interface IRealtimeEngine {
  ensure(
    context: IExecutionContext,
    docId: RealtimeDocId,
    initial: unknown
  ): Promise<Result<void, DomainError>>;

  applyChange(
    context: IExecutionContext,
    docId: RealtimeDocId,
    change: RealtimeChange | ReadonlyArray<RealtimeChange>,
    options?: RealtimeApplyChangeOptions
  ): Promise<Result<void, DomainError>>;

  delete(
    context: IExecutionContext,
    docId: RealtimeDocId,
    options?: RealtimeApplyChangeOptions
  ): Promise<Result<void, DomainError>>;

  /**
   * Notify collection query subscribers when a bulk storage mutation has no
   * meaningful per-document operation to publish.
   */
  invalidateCollection(
    context: IExecutionContext,
    collection: string,
    change: RealtimeChange
  ): Promise<Result<void, DomainError>>;
}
