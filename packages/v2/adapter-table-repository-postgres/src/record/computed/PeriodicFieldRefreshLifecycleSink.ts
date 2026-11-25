import type { FieldBackfillPeriodicRefreshMeta } from './outbox/FieldBackfillOutboxPayload';

export type PeriodicFieldRefreshCompletedEvent = FieldBackfillPeriodicRefreshMeta & {
  baseId: string;
  taskId: string;
  completedAt: Date;
};

export type PeriodicFieldRefreshFailedEvent = FieldBackfillPeriodicRefreshMeta & {
  baseId: string;
  taskId: string;
  message: string;
  failedAt: Date;
};

/**
 * Host lifecycle hook invoked by ComputedUpdateWorker strictly when an async
 * periodic-refresh stage chain finishes its final stage or terminates with failure.
 */
export interface IPeriodicFieldRefreshLifecycleSink {
  onCompleted(event: PeriodicFieldRefreshCompletedEvent): Promise<void>;
  onFailed(event: PeriodicFieldRefreshFailedEvent): Promise<void>;
}

export const noopPeriodicFieldRefreshLifecycleSink: IPeriodicFieldRefreshLifecycleSink = {
  onCompleted: () => Promise.resolve(),
  onFailed: () => Promise.resolve(),
};
