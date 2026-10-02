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

export type RealtimeEnsureOptions = {
  /**
   * The caller only guards a following applyChange on a document that is
   * already persisted, so no collection query can gain a new member. Engines
   * that broadcast creation (ShareDB) then notify doc subscribers only and
   * leave collection query subscriptions alone, which otherwise re-poll for
   * every subscriber on each create.
   */
  expectExisting?: boolean;
};

export interface IRealtimeEngine {
  ensure(
    context: IExecutionContext,
    docId: RealtimeDocId,
    initial: unknown,
    options?: RealtimeEnsureOptions
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

  /**
   * Signal that a table's derived compute activity changed. Subscribers refetch
   * the authoritative snapshot over HTTP; the signal carries no activity data.
   */
  notifyTableComputeActivity(
    context: IExecutionContext,
    tableId: string
  ): Promise<Result<void, DomainError>>;
}
