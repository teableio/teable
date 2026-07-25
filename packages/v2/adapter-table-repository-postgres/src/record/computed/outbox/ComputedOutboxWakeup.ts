import { generatePrefixedId } from '@teable/v2-core';

const WAKEUP_ID_PREFIX = 'cuw';
const WAKEUP_ID_BODY_LENGTH = 16;

export type ComputedOutboxWakeupCause = 'created' | 'merged' | 'retry' | 'replay';

export type ComputedOutboxWakeup = Readonly<{
  schemaVersion: 1;
  wakeupId: string;
  taskId: string;
  baseId: string;
  availableAt: Date;
  emittedAt: Date;
  cause: ComputedOutboxWakeupCause;
}>;

export type ComputedOutboxWakeupPublishOutcome = { status: 'accepted' } | { status: 'disabled' };

export type ComputedOutboxWakeupSkipReason = 'no_after_commit' | 'publish_failed';

export interface IComputedOutboxWakeupPublisher {
  publish(wakeup: ComputedOutboxWakeup): Promise<ComputedOutboxWakeupPublishOutcome>;
  /** Register for broker recovery after a publication failure. */
  onDeliveryRecovered?(listener: () => void): () => void;
  /**
   * Optional observability hook for wake-ups that never reach the broker.
   * No-op publishers may leave this unimplemented.
   */
  recordSkip?(reason: ComputedOutboxWakeupSkipReason): void;
}

export const noopComputedOutboxWakeupPublisher: IComputedOutboxWakeupPublisher = {
  publish: async () => ({ status: 'disabled' }),
};

export const createComputedOutboxWakeup = (params: {
  wakeupId?: string;
  taskId: string;
  baseId: string;
  availableAt?: Date;
  cause: ComputedOutboxWakeupCause;
}): ComputedOutboxWakeup => ({
  schemaVersion: 1,
  wakeupId: params.wakeupId ?? generatePrefixedId(WAKEUP_ID_PREFIX, WAKEUP_ID_BODY_LENGTH),
  taskId: params.taskId,
  baseId: params.baseId,
  availableAt: params.availableAt ?? new Date(),
  emittedAt: new Date(),
  cause: params.cause,
});
