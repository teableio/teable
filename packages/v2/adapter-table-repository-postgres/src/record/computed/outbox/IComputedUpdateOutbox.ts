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
  /**
   * Lease duration for claimed `processing` tasks.
   * Workers must renew `locked_at` before this expires.
   */
  processingLeaseMs: number;
  /**
   * Heartbeat interval for renewing claimed task leases.
   * Values slower than the lease window are clamped during registration.
   */
  heartbeatIntervalMs: number;
  /**
   * Upper bound of stale `processing` tasks reclaimed per batch.
   * Pending work still fills the remaining batch capacity.
   */
  reclaimBatchSize: number;
  /**
   * Upper bound of seed records executed by a single worker task.
   * Larger claimed tasks are split into child tasks before acquiring computed locks.
   */
  maxSeedRecordsPerTask: number;
};

export const defaultComputedUpdateOutboxConfig: ComputedUpdateOutboxConfig = {
  seedInlineLimit: 5000,
  maxAttempts: 8,
  baseBackoffMs: 5000,
  maxBackoffMs: 5 * 60 * 1000,
  processingLeaseMs: 2 * 60 * 1000,
  heartbeatIntervalMs: 30 * 1000,
  reclaimBatchSize: 50,
  maxSeedRecordsPerTask: 500,
};

export const normalizeComputedUpdateOutboxConfig = (
  config: ComputedUpdateOutboxConfig
): ComputedUpdateOutboxConfig => {
  const processingLeaseMs = Math.max(5000, Math.trunc(config.processingLeaseMs));
  const recommendedHeartbeat = Math.max(1000, Math.trunc(processingLeaseMs / 3));
  return {
    ...config,
    processingLeaseMs,
    heartbeatIntervalMs: Math.max(
      1000,
      Math.min(Math.trunc(config.heartbeatIntervalMs), recommendedHeartbeat)
    ),
    reclaimBatchSize: Math.max(1, Math.trunc(config.reclaimBatchSize)),
    maxSeedRecordsPerTask: Math.max(1, Math.trunc(config.maxSeedRecordsPerTask)),
  };
};

export type ClaimBatchParams = {
  workerId: string;
  limit: number;
  now?: Date;
};

export type ClaimByIdParams = {
  taskId: string;
  workerId: string;
  now?: Date;
  allowProcessingTakeover?: boolean;
};

export type RenewLeaseParams = {
  taskIds: string[];
  leaseOwner: string;
  now?: Date;
};

export type ReleaseForRetryParams = {
  task: AnyOutboxItem;
  reason: string;
  retryDelayMs?: number;
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

  claimById(
    params: ClaimByIdParams,
    context?: IExecutionContext
  ): Promise<Result<AnyOutboxItem | null, DomainError>>;

  renewLease(
    params: RenewLeaseParams,
    context?: IExecutionContext
  ): Promise<Result<ReadonlyArray<string>, DomainError>>;

  releaseForRetry(
    params: ReleaseForRetryParams,
    context?: IExecutionContext
  ): Promise<Result<boolean, DomainError>>;

  markDone(
    taskOrId: AnyOutboxItem | string,
    context?: IExecutionContext
  ): Promise<Result<boolean, DomainError>>;

  markFailed(
    task: AnyOutboxItem,
    error: string,
    context?: IExecutionContext
  ): Promise<Result<boolean, DomainError>>;
}
