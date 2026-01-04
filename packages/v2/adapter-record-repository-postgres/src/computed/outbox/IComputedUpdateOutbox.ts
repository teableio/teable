import type { DomainError, IExecutionContext } from '@teable/v2-core';
import type { Result } from 'neverthrow';

import type {
  ComputedUpdateOutboxItem,
  ComputedUpdateOutboxTaskInput,
} from './ComputedUpdateOutboxPayload';

export type ComputedUpdateOutboxConfig = {
  /** Inline seed storage limit before spilling to computed_update_outbox_seed. */
  seedInlineLimit: number;
  /** Maximum retry attempts before moving to dead letter. */
  maxAttempts: number;
  /** Base backoff in milliseconds for retry scheduling. */
  baseBackoffMs: number;
  /** Max backoff in milliseconds for retry scheduling. */
  maxBackoffMs: number;
};

export const defaultComputedUpdateOutboxConfig: ComputedUpdateOutboxConfig = {
  seedInlineLimit: 5000,
  maxAttempts: 8,
  baseBackoffMs: 5000,
  maxBackoffMs: 5 * 60 * 1000,
};

export type ClaimBatchParams = {
  workerId: string;
  limit: number;
  now?: Date;
};

export interface IComputedUpdateOutbox {
  enqueueOrMerge(
    task: ComputedUpdateOutboxTaskInput,
    context?: IExecutionContext
  ): Promise<Result<{ taskId: string; merged: boolean }, DomainError>>;

  claimBatch(
    params: ClaimBatchParams,
    context?: IExecutionContext
  ): Promise<Result<ReadonlyArray<ComputedUpdateOutboxItem>, DomainError>>;

  markDone(taskId: string, context?: IExecutionContext): Promise<Result<void, DomainError>>;

  markFailed(
    task: ComputedUpdateOutboxItem,
    error: string,
    context?: IExecutionContext
  ): Promise<Result<void, DomainError>>;
}
