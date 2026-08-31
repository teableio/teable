import type { PostgresSqlExecutionDiagnostics } from '@teable/v2-adapter-db-postgres-shared';
import type {
  DomainError,
  FieldComputeBatch,
  FieldComputeTarget,
  IExecutionContext,
} from '@teable/v2-core';
import type { Result } from 'neverthrow';

import type {
  ComputedActivityProjectionResult,
  ComputedActivityStageSettlementParams,
} from '../activity/IComputedActivityProjector';
import type {
  ComputedUpdateOutboxItem,
  ComputedUpdateOutboxTaskInput,
} from './ComputedUpdateOutboxPayload';
import type { ComputedUpdateSeedTaskInput } from './ComputedUpdateSeedPayload';
import type { FieldBackfillOutboxTaskInput } from './FieldBackfillOutboxPayload';

/**
 * ROLLOUT NOTE: the stage-budget dimensions are ON by default (no runtime
 * toggle — a deliberate product decision to keep the fix active everywhere).
 * The FIRST upgrade from a pre-stage version has a one-time mixed-fleet
 * window: a pre-stage worker that claims a ledger continuation (empty seed
 * set + ledgerScopeId) misreads it as a schema-update whole-table recompute
 * and runs it as one unbounded transaction. Values converge (whole-table
 * recompute is idempotent) but the transaction is the incident-class size,
 * so schedule that first upgrade all-at-once or in a quiet window. Upgrades
 * between stage-aware versions have no such window.
 */
export type ComputedUpdateOutboxConfig = {
  /** Inline seed storage limit before spilling to computed_update_outbox_seed. */
  seedInlineLimit: number;
  /** Maximum retry attempts before moving to dead letter. */
  maxAttempts: number;
  /** Base backoff in milliseconds for retry scheduling. */
  baseBackoffMs: number;
  /** Delay before retrying a transient computed advisory-lock conflict. */
  lockUnavailableRetryDelayMs: number;
  /** Max backoff in milliseconds for retry scheduling. */
  maxBackoffMs: number;
  /**
   * Retained for config compatibility. Trashed tables now complete or skip
   * instead of deferring until this age cap and dead-lettering.
   */
  inactiveTableDeferMaxAgeMs: number;
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
  /**
   * Maximum records updated by one field-backfill task transaction.
   * Larger tables continue through cursor-based outbox tasks.
   */
  fieldBackfillBatchSize: number;
  /**
   * Maximum dependency-plan steps executed per worker transaction. Plans above the
   * budget run as a level-ordered prefix; remaining steps continue in a follow-up
   * outbox task committed atomically with the current stage. 0 disables staging.
   */
  stageMaxSteps: number;
  /**
   * Maximum computed fields (summed across steps) executed per worker transaction.
   * 0 disables the field budget.
   */
  stageMaxFields: number;
  /**
   * Maximum dirty-propagation edges evaluated per worker transaction. Under a
   * dirty budget each edge runs as its own bounded statement; this caps how many
   * such statements one stage executes. 0 disables the edge budget.
   */
  stageMaxEdges: number;
  /**
   * Small runs (estimated complexity at or below this threshold, no whole-table
   * seeds) multiply the three stage budgets above by
   * stageSmallRunBudgetMultiplier, so trivial cascades do not pay per-task
   * pipeline overhead for a dozen tiny slices. Volume misestimates degrade
   * gracefully: the dirty budget still aborts an over-budget stage before any
   * step commits, and the shrink loop re-splits. 0 disables adaptivity.
   */
  stageSmallRunComplexityThreshold: number;
  /** Budget multiplier applied to small runs. Values below 1 clamp to 1. */
  stageSmallRunBudgetMultiplier: number;
  /**
   * Maximum dirty records (seeds + propagated) materialized per stage transaction.
   * Propagation stops at a generation boundary once the running total exceeds this;
   * the worker then retries the stage with half as many steps until it fits, so the
   * static step/field/edge budgets get a data-driven hard backstop. A stage already
   * reduced to a single step record-batches instead: it executes the bounded batch
   * and continues with processed targets excluded until propagation completes.
   * Full-table (seed-all / schema-update) seeding, the stage-ledger frontier
   * queue, and explicit seeds all count against this budget: partial (floor)
   * batches migrate seeds into the queue and share one seeding+propagation
   * pool; abort-mode stages refuse to materialize a seed set that does not
   * fit and shrink to the floor instead. Every budgeted transaction therefore
   * materializes at most this many dirty rows (+1 abort-probe sentinel row,
   * discarded with the aborted attempt) — the transaction-level hard cap.
   * Values of 1 are clamped to 2 so both pools keep a slot. 0 disables.
   */
  stageMaxDirtyRecords: number;
  /**
   * Hard cap on exact seed record ids a completed stage may fetch into JS (and
   * hence carry into follow-up planning) across ALL its tables. Tables whose
   * union of batch outputs and exclusion ledger would push past the cap are
   * collected as whole-table seeds instead, so stage-completion memory stays
   * bounded even when many tables sit just under stageSeedAllThreshold.
   */
  stageMaxCollectedSeedIds: number;
  /**
   * Dirty-row count per table above which stage continuations switch from explicit
   * record ids to a seed-all representation. 0 falls back to the built-in default.
   */
  stageSeedAllThreshold: number;
  /**
   * Claim freshly inserted cascade continuations inside the enqueuing worker
   * transaction (relay claim), skipping the separate claim transaction between
   * stages. Disable to fall back to the wakeup/relay claimById path per hop.
   */
  continuationRelayClaimEnabled: boolean;
  /**
   * Record every successful task completion into computed_update_run_history
   * (lineage / latency ledger). One small insert inside the markDone
   * transaction; disable to skip the ledger entirely.
   */
  runHistoryEnabled: boolean;
  /**
   * Retention window for computed_update_run_history rows. Expired rows are
   * pruned opportunistically after successful completions. 0 disables pruning.
   */
  runHistoryRetentionMs: number;
};

export const defaultComputedUpdateOutboxConfig: ComputedUpdateOutboxConfig = {
  seedInlineLimit: 5000,
  maxAttempts: 8,
  baseBackoffMs: 5000,
  lockUnavailableRetryDelayMs: 250,
  maxBackoffMs: 5 * 60 * 1000,
  inactiveTableDeferMaxAgeMs: 24 * 60 * 60 * 1000,
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
  fieldBackfillBatchSize: 500,
  // Wide dependency graphs (hub tables with hundreds of computed fields) must not run
  // as one transaction on small BYODB instances; bound each stage and continue via outbox.
  stageMaxSteps: 10,
  stageMaxFields: 32,
  stageMaxEdges: 12,
  stageSmallRunComplexityThreshold: 512,
  stageSmallRunBudgetMultiplier: 4,
  stageMaxDirtyRecords: 5000,
  stageMaxCollectedSeedIds: 25_000,
  stageSeedAllThreshold: 5000,
  continuationRelayClaimEnabled: true,
  runHistoryEnabled: true,
  runHistoryRetentionMs: 7 * 24 * 60 * 60 * 1000,
};

export const normalizeComputedUpdateOutboxConfig = (
  config: ComputedUpdateOutboxConfig
): ComputedUpdateOutboxConfig => {
  const processingLeaseMs = Math.max(5000, Math.trunc(config.processingLeaseMs));
  const recommendedHeartbeat = Math.max(1000, Math.trunc(processingLeaseMs / 3));
  return {
    ...config,
    lockUnavailableRetryDelayMs: Math.max(0, Math.trunc(config.lockUnavailableRetryDelayMs)),
    inactiveTableDeferMaxAgeMs: Math.max(0, Math.trunc(config.inactiveTableDeferMaxAgeMs)),
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
    fieldBackfillBatchSize: Math.max(1, Math.trunc(config.fieldBackfillBatchSize)),
    stageMaxSteps: Math.max(0, Math.trunc(config.stageMaxSteps)),
    stageMaxFields: Math.max(0, Math.trunc(config.stageMaxFields)),
    stageMaxEdges: Math.max(0, Math.trunc(config.stageMaxEdges)),
    stageSmallRunComplexityThreshold: Math.max(
      0,
      Math.trunc(config.stageSmallRunComplexityThreshold)
    ),
    stageSmallRunBudgetMultiplier: Math.max(1, Math.trunc(config.stageSmallRunBudgetMultiplier)),
    stageMaxDirtyRecords: (() => {
      const value = Math.max(0, Math.trunc(config.stageMaxDirtyRecords));
      // A 1-row budget cannot give both the seeding and propagation pools a slot.
      return value === 1 ? 2 : value;
    })(),
    stageMaxCollectedSeedIds: Math.max(1, Math.trunc(config.stageMaxCollectedSeedIds)),
    stageSeedAllThreshold: Math.max(0, Math.trunc(config.stageSeedAllThreshold)),
    continuationRelayClaimEnabled: config.continuationRelayClaimEnabled !== false,
    runHistoryEnabled: config.runHistoryEnabled !== false,
    runHistoryRetentionMs: Math.max(0, Math.trunc(config.runHistoryRetentionMs)),
  };
};

export type ClaimBatchParams = {
  workerId: string;
  limit: number;
  now?: Date;
};

export type EnqueueOrMergeOptions = {
  /**
   * Relay-claim a freshly inserted cascade continuation for the calling worker
   * inside the enqueue transaction, so the worker can process it without a
   * separate claim transaction between stages. Only applies to fresh inserts;
   * merged tasks always fall back to the wakeup/claimById relay path. The
   * enqueue-published wakeup is still scheduled as the crash safety net.
   */
  relayClaim?: {
    workerId: string;
    /**
     * The predecessor task being marked done in the same transaction; excluded
     * from the concurrency-cap check so the cascade hand-off does not count
     * itself as a blocker.
     */
    predecessorTaskId: string;
  };
  /**
   * Skip this call's own activity-projector round (onTaskEnqueued / the
   * relay-claim's onTasksClaimed) and instead return `pendingActivityEnqueue`
   * so the caller can fold it into one combined projection alongside its
   * markDone call (see IComputedUpdateOutbox.projectStageSettlement). The
   * outbox row itself (insert/merge, and the relay-claim's processing flip)
   * still runs unconditionally — only the activity bookkeeping is deferred.
   */
  skipActivityProjection?: boolean;
};

export type PendingActivityEnqueue = {
  taskId: string;
  baseId: string;
  targets: ReadonlyArray<FieldComputeTarget>;
  metrics: {
    estimatedComplexity: number;
    estimatedDirtyRecords: number;
    hasAllTargetRecords: boolean;
    batchProgress?: FieldComputeBatch;
  };
};

export type EnqueueOrMergeOutcome = {
  taskId: string;
  merged: boolean;
  /** Present iff relayClaim was requested and the pre-claim succeeded. */
  claimed?: AnyOutboxItem | null;
  /**
   * Present iff `options.skipActivityProjection` was set and there are targets
   * to project. Feed this into projectStageSettlement's `enqueued` param.
   */
  pendingActivityEnqueue?: PendingActivityEnqueue;
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

export type MarkDoneOptions = {
  /**
   * Skip this call's own activity-projector round (onTaskDone) and let the
   * caller fold it into a combined projection alongside its enqueueOrMerge
   * call via projectStageSettlement. The outbox row deletion still runs
   * unconditionally — only the activity bookkeeping is deferred.
   */
  skipActivityProjection?: boolean;
  /** Field-level failures to stamp on activity after a successful task completion. */
  fieldErrors?: ComputedActivityStageSettlementParams['done']['fieldErrors'];
  /**
   * DAG slice to persist on the history row (seed executed plan, or this
   * leftover's steps/edges). When omitted, the outbox row's steps/edges are
   * used so continuations still have a graph if the seed row is missing.
   */
  runHistoryPlan?: { steps: unknown; edges: unknown };
};

export type MarkFailedOptions = {
  failureKind?: string;
  failureReason?: string;
  retryable?: boolean;
  directDeadLetter?: boolean;
  diagnostics?: ComputedTaskFailureDiagnostics;
};

export type ComputedTaskFailureDiagnostics = {
  readonly version: 1;
  readonly failure: {
    readonly kind?: string;
    readonly reason?: string;
    readonly retryable?: boolean;
    readonly directDeadLetter: boolean;
    readonly phase?: string;
    readonly details?: Readonly<Record<string, unknown>>;
  };
  readonly execution?: PostgresSqlExecutionDiagnostics;
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
  sourceChangedAt?: Date;
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

export type RegisterPlannedTaskActivityParams = {
  taskId: string;
  baseId: string;
  targets: ReadonlyArray<FieldComputeTarget>;
  metrics: {
    estimatedComplexity: number;
    estimatedDirtyRecords: number;
    hasAllTargetRecords: boolean;
    batchProgress?: FieldComputeBatch;
  };
  now?: Date;
};

export interface IComputedUpdateOutbox {
  enqueueOrMerge(
    task: ComputedUpdateOutboxTaskInput,
    context?: IExecutionContext,
    options?: EnqueueOrMergeOptions
  ): Promise<Result<EnqueueOrMergeOutcome, DomainError>>;

  /**
   * Enqueue a seed task to the outbox.
   * Seed tasks contain minimal trigger information - the full plan is computed
   * asynchronously by the worker. This allows fast response times for record updates.
   */
  enqueueSeedTask(
    task: ComputedUpdateSeedTaskInput,
    context?: IExecutionContext
  ): Promise<Result<{ taskId: string; merged: boolean }, DomainError>>;

  /** Register the computed targets discovered while planning a claimed seed task. */
  registerPlannedTaskActivity(
    params: RegisterPlannedTaskActivityParams,
    context?: IExecutionContext
  ): Promise<Result<void, DomainError>>;

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
    context?: IExecutionContext,
    options?: MarkDoneOptions
  ): Promise<Result<boolean, DomainError>>;

  /**
   * Combined tail for one stage transaction: settle the completed task, its
   * freshly enqueued continuation, and its relay-claim in a single activity
   * projection round. Call after enqueueOrMerge/markDone were both invoked
   * with `skipActivityProjection: true` in the same transaction — see
   * ComputedUpdateWorker's stage settlement hand-off.
   */
  projectStageSettlement(
    params: ComputedActivityStageSettlementParams,
    context?: IExecutionContext
  ): Promise<Result<ComputedActivityProjectionResult | null, DomainError>>;

  markFailed(
    task: AnyOutboxItem,
    error: string,
    context?: IExecutionContext,
    options?: MarkFailedOptions
  ): Promise<Result<boolean, DomainError>>;

  /**
   * Drop pending tasks and dead letters seeded from a table that is being
   * permanently deleted. Such tasks fail deterministically ("Table not found")
   * on every attempt — and a dead letter replayed after the drop dies the same
   * way — so discarding them up front avoids futile retries and permanently
   * stranded anomaly entries. Processing tasks are left to their lease owners:
   * they terminate through the normal markDone/markFailed lifecycle.
   */
  discardBySeedTable(
    params: { baseId: string; seedTableId: string },
    context?: IExecutionContext
  ): Promise<
    Result<
      {
        discardedTaskIds: ReadonlyArray<string>;
        discardedDeadLetterTaskIds: ReadonlyArray<string>;
      },
      DomainError
    >
  >;
}
