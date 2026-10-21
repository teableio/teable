import type {
  DomainError,
  FieldComputeLastError,
  FieldComputeMetaDto,
  FieldComputeBatch,
  FieldComputeTarget,
  IExecutionContext,
  TableComputeMetaDto,
} from '@teable/v2-core';
import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

export type ComputedActivityTaskMetrics = {
  estimatedComplexity: number;
  estimatedDirtyRecords: number;
  hasAllTargetRecords: boolean;
  batchProgress?: FieldComputeBatch;
};

export type ComputedActivityOrchestration = {
  operationId?: string;
  groupId?: string;
  totalChunkCount: number;
  chunkIndex: number;
};

export const toComputedActivityBatch = (
  orchestration: ComputedActivityOrchestration | undefined
): FieldComputeBatch | undefined => {
  if (!orchestration) return undefined;
  const groupId = orchestration.groupId ?? orchestration.operationId;
  if (
    !groupId ||
    !Number.isFinite(orchestration.totalChunkCount) ||
    !Number.isFinite(orchestration.chunkIndex)
  ) {
    return undefined;
  }
  const total = Math.max(1, Math.trunc(orchestration.totalChunkCount));
  return {
    groupId,
    total,
    completed: Math.max(0, Math.min(total, Math.trunc(orchestration.chunkIndex))),
  };
};

export type ComputedActivityProjectionResult = {
  baseId: string;
  fields: FieldComputeMetaDto[];
  tables: TableComputeMetaDto[];
};

/**
 * Optional DB handle already participating in the outbox transaction.
 * When provided, projector mutates activity tables on the same connection.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ComputedActivityDbHandle = any;

export type ComputedActivityFieldError = {
  fieldId: string;
  error: FieldComputeLastError;
};

export type ComputedActivityStageSettlementParams = {
  /** The task being completed in the same stage transaction. */
  done: {
    taskId: string;
    baseId?: string;
    durationMs?: number;
    error?: FieldComputeLastError | null;
    fieldErrors?: ReadonlyArray<ComputedActivityFieldError>;
  };
  /** The follow-up continuation task enqueued in the same stage transaction, if any. */
  enqueued?: {
    taskId: string;
    baseId: string;
    targets: ReadonlyArray<FieldComputeTarget>;
    metrics: ComputedActivityTaskMetrics;
  };
  /**
   * Tasks relay-claimed in the same stage transaction (normally just the
   * `enqueued` task's own id, when the enqueuing worker claims its own
   * continuation).
   */
  claimed?: ReadonlyArray<{ taskId: string; baseId: string }>;
  now?: Date;
  trx?: ComputedActivityDbHandle;
};

/**
 * Maintains field/table compute metadata projections alongside the computed outbox lifecycle.
 */
export interface IComputedActivityProjector {
  onTaskEnqueued(
    params: {
      taskId: string;
      baseId: string;
      targets: ReadonlyArray<FieldComputeTarget>;
      metrics: ComputedActivityTaskMetrics;
      now?: Date;
      trx?: ComputedActivityDbHandle;
    },
    context?: IExecutionContext
  ): Promise<Result<ComputedActivityProjectionResult | null, DomainError>>;

  onTasksClaimed(
    params: {
      tasks: ReadonlyArray<{
        taskId: string;
        baseId: string;
      }>;
      now?: Date;
      trx?: ComputedActivityDbHandle;
    },
    context?: IExecutionContext
  ): Promise<Result<ComputedActivityProjectionResult | null, DomainError>>;

  onTaskDone(
    params: {
      taskId: string;
      baseId?: string;
      durationMs?: number;
      fieldErrors?: ReadonlyArray<ComputedActivityFieldError>;
      now?: Date;
      trx?: ComputedActivityDbHandle;
    },
    context?: IExecutionContext
  ): Promise<Result<ComputedActivityProjectionResult | null, DomainError>>;

  onTaskFailed(
    params: {
      taskId: string;
      baseId?: string;
      error: FieldComputeLastError;
      /** When true, release the task ref (terminal). When false, only clear processing (retry). */
      terminal: boolean;
      durationMs?: number;
      now?: Date;
      trx?: ComputedActivityDbHandle;
    },
    context?: IExecutionContext
  ): Promise<Result<ComputedActivityProjectionResult | null, DomainError>>;

  /**
   * Combined tail for one outbox-worker stage transaction: settle the
   * completed task, the freshly enqueued continuation (if any), and its
   * relay-claim (if any) with a single lock round, a single load, and a
   * single persist instead of one independent round per call. Semantics
   * match calling onTaskEnqueued, onTasksClaimed, and onTaskDone
   * back-to-back in the same transaction (see ComputedUpdateWorker's
   * enqueue+markDone hand-off).
   */
  projectStageSettlement(
    params: ComputedActivityStageSettlementParams,
    context?: IExecutionContext
  ): Promise<Result<ComputedActivityProjectionResult | null, DomainError>>;

  /**
   * Reconcile field/table activity for one table from persisted task-field refs.
   * Heals orphaned queued/running counters that no longer have outbox refs.
   *
   * lockTimeoutMs bounds the wait for the per-table advisory lock; pass 0 to
   * try once and give up (returns ok(null)) when another connection is already
   * reconciling — read-path callers must use this so concurrent polls across
   * pods collapse into a single flight instead of each parking a pool
   * connection on the same global lock.
   */
  reconcileTable(
    params: {
      tableId: string;
      baseId?: string;
      now?: Date;
      trx?: ComputedActivityDbHandle;
      lockTimeoutMs?: number;
    },
    context?: IExecutionContext
  ): Promise<Result<ComputedActivityProjectionResult | null, DomainError>>;

  /**
   * Optional realtime publish hook used after read-time healing.
   * Implementations without an event bus may no-op.
   */
  publishActivityChanged?(
    projection: ComputedActivityProjectionResult | null | undefined,
    context?: IExecutionContext
  ): Promise<void>;
}

export const noopComputedActivityProjector: IComputedActivityProjector = {
  async onTaskEnqueued() {
    return ok(null);
  },
  async onTasksClaimed() {
    return ok(null);
  },
  async onTaskDone() {
    return ok(null);
  },
  async onTaskFailed() {
    return ok(null);
  },
  async projectStageSettlement() {
    return ok(null);
  },
  async reconcileTable() {
    return ok(null);
  },
  async publishActivityChanged() {
    return;
  },
};
