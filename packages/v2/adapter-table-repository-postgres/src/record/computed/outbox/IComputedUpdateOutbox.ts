import type { DomainError, IExecutionContext } from '@teable/v2-core';
import type { Result } from 'neverthrow';

import type {
  ComputedUpdateOutboxItem,
  ComputedUpdateOutboxTaskInput,
} from './ComputedUpdateOutboxPayload';
import type { ComputedUpdateSeedTaskInput } from './ComputedUpdateSeedPayload';
import type { FieldBackfillOutboxTaskInput } from './FieldBackfillOutboxPayload';

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

/**
 * Outbox item for field backfill tasks.
 */
export type FieldBackfillOutboxItem = FieldBackfillOutboxTaskInput & {
  id: string;
  status: 'pending' | 'processing' | 'done' | 'dead';
  attempts: number;
  maxAttempts: number;
  nextRunAt: Date;
  lockedAt?: Date | null;
  lockedBy?: string | null;
  lastError?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Outbox item for seed tasks (minimal trigger info, plan computed by worker).
 */
export type SeedOutboxItem = ComputedUpdateSeedTaskInput & {
  id: string;
  status: 'pending' | 'processing' | 'done' | 'dead';
  attempts: number;
  maxAttempts: number;
  nextRunAt: Date;
  lockedAt?: Date | null;
  lockedBy?: string | null;
  lastError?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Union type for all outbox items.
 */
export type AnyOutboxItem = ComputedUpdateOutboxItem | FieldBackfillOutboxItem | SeedOutboxItem;

/**
 * Type guard to check if an outbox item is a field backfill task.
 */
export const isFieldBackfillOutboxItem = (item: AnyOutboxItem): item is FieldBackfillOutboxItem => {
  return (item as FieldBackfillOutboxItem).taskType === 'field-backfill';
};

/**
 * Type guard to check if an outbox item is a seed task.
 */
export const isSeedOutboxItem = (item: AnyOutboxItem): item is SeedOutboxItem => {
  return (item as SeedOutboxItem).taskType === 'seed';
};

export interface IComputedUpdateOutbox {
  enqueueOrMerge(
    task: ComputedUpdateOutboxTaskInput,
    context?: IExecutionContext
  ): Promise<Result<{ taskId: string; merged: boolean }, DomainError>>;

  /**
   * Enqueue a seed task to the outbox.
   * Seed tasks contain minimal trigger information - the full plan is computed
   * asynchronously by the worker. This allows fast response times for record updates.
   */
  enqueueSeedTask(
    task: ComputedUpdateSeedTaskInput,
    context?: IExecutionContext
  ): Promise<Result<{ taskId: string; merged: boolean }, DomainError>>;

  /**
   * Enqueue a field backfill task to the outbox.
   * Field backfill tasks update all records in a table for specific computed fields.
   */
  enqueueFieldBackfill(
    task: FieldBackfillOutboxTaskInput,
    context?: IExecutionContext
  ): Promise<Result<{ taskId: string; merged: boolean }, DomainError>>;

  claimBatch(
    params: ClaimBatchParams,
    context?: IExecutionContext
  ): Promise<Result<ReadonlyArray<AnyOutboxItem>, DomainError>>;

  markDone(taskId: string, context?: IExecutionContext): Promise<Result<void, DomainError>>;

  markFailed(
    task: AnyOutboxItem,
    error: string,
    context?: IExecutionContext
  ): Promise<Result<void, DomainError>>;
}
