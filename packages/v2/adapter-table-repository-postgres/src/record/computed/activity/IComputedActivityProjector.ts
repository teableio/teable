import type {
  DomainError,
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
      now?: Date;
      trx?: ComputedActivityDbHandle;
    },
    context?: IExecutionContext
  ): Promise<Result<ComputedActivityProjectionResult | null, DomainError>>;

  onTaskFailed(
    params: {
      taskId: string;
      baseId?: string;
      error: { code?: string; message: string };
      /** When true, release the task ref (terminal). When false, only clear processing (retry). */
      terminal: boolean;
      durationMs?: number;
      now?: Date;
      trx?: ComputedActivityDbHandle;
    },
    context?: IExecutionContext
  ): Promise<Result<ComputedActivityProjectionResult | null, DomainError>>;

  /**
   * Reconcile field/table activity for one table from persisted task-field refs.
   * Heals orphaned queued/running counters that no longer have outbox refs.
   */
  reconcileTable(
    params: {
      tableId: string;
      baseId?: string;
      now?: Date;
      trx?: ComputedActivityDbHandle;
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
  async reconcileTable() {
    return ok(null);
  },
  async publishActivityChanged() {
    return;
  },
};
