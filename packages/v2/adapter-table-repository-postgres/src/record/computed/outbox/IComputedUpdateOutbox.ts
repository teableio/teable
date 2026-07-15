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
  /**
   * When a claimed task's dirtyStats total is at least this many rows and the plan has
   * no allTargetRecords edges, split more aggressively using fanoutSeedSplitMaxSeeds.
   * 0 disables fanout-aware splitting.
   */
  fanoutDirtyRecordsThreshold: number;
  /**
   * Seed-record cap used when fanoutDirtyRecordsThreshold is exceeded (linkTraversal-only).
   * Must be <= maxSeedRecordsPerTask. Ignored when fanout threshold is 0.
   */
  fanoutSeedSplitMaxSeeds: number;
  /**
   * Maximum active processing tasks for the same base before pending claims are deferred.
   * Stale processing rows can still be reclaimed after the lease window.
   */
  maxConcurrentProcessingPerBase: number;
  /**
   * Maximum active processing tasks for the same base + seed table before pending claims are
   * deferred. This keeps duplicate hot seed work from being claimed by multiple workers.
   */
  maxConcurrentProcessingPerSeedTable: number;
  /**
   * Per-statement timeout applied inside computed worker task transactions.
   * A value of 0 disables the database-side timeout.
   */
  taskStatementTimeoutMs: number;
};

export const defaultComputedUpdateOutboxConfig: ComputedUpdateOutboxConfig = {
  seedInlineLimit: 5000,
  maxAttempts: 8,
  baseBackoffMs: 5000,
  maxBackoffMs: 5 * 60 * 1000,
  processingLeaseMs: 2 * 60 * 1000,
  heartbeatIntervalMs: 30 * 1000,
  reclaimBatchSize: 50,
  maxSeedRecordsPerTask: 5000,
  // Large dirty fan-out with few seeds (e.g. hub order updates) still fits under
  // maxSeedRecordsPerTask; lower the cap so linkTraversal-only work can parallelize.
  fanoutDirtyRecordsThreshold: 2000,
  fanoutSeedSplitMaxSeeds: 5,
  maxConcurrentProcessingPerBase: 2,
  maxConcurrentProcessingPerSeedTable: 2,
  taskStatementTimeoutMs: 60 * 1000,
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
    fanoutDirtyRecordsThreshold: Math.max(0, Math.trunc(config.fanoutDirtyRecordsThreshold)),
    fanoutSeedSplitMaxSeeds: Math.max(1, Math.trunc(config.fanoutSeedSplitMaxSeeds)),
    maxConcurrentProcessingPerBase: Math.max(1, Math.trunc(config.maxConcurrentProcessingPerBase)),
    maxConcurrentProcessingPerSeedTable: Math.max(
      1,
      Math.trunc(config.maxConcurrentProcessingPerSeedTable)
    ),
    taskStatementTimeoutMs: Math.max(0, Math.trunc(config.taskStatementTimeoutMs)),
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

export type OutboxTaskClaimEligibility =
  | { status: 'terminal' }
  | { status: 'eligible' }
  | {
      status: 'deferred';
      reason: 'not_due' | 'active_lease' | 'paused' | 'concurrency';
      /** Null when eligibility depends on an explicit resume or another worker completing. */
      retryAt: Date | null;
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

export type MarkFailedOptions = {
  failureKind?: string;
  failureReason?: string;
  retryable?: boolean;
  directDeadLetter?: boolean;
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

  getTaskClaimEligibility(
    taskId: string,
    context?: IExecutionContext
  ): Promise<Result<OutboxTaskClaimEligibility | null, DomainError>>;

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
    context?: IExecutionContext,
    options?: MarkFailedOptions
  ): Promise<Result<boolean, DomainError>>;
}
