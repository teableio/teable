import {
  BaseId,
  FieldId,
  TableId,
  type DomainError,
  type IHasher,
  type TracePropagationCarrier,
} from '@teable/v2-core';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

/**
 * Task type discriminator for outbox items.
 * - 'computed-update': Standard computed field update (dirty record propagation) - contains full plan
 * - 'field-backfill': Backfill computed field values for all records in a table
 * - 'seed': Minimal seed task that triggers async plan computation and execution
 */
export type OutboxTaskType = 'computed-update' | 'field-backfill' | 'seed';

/**
 * Payload for field backfill tasks.
 * Unlike computed-update, this doesn't track individual records -
 * it updates ALL records in the table for the specified fields.
 */
export type FieldBackfillStageEntry = {
  tableId: string;
  fieldIds: string[];
};

export type FieldBackfillPeriodicRefreshMeta = {
  sourceFieldId: string;
  sourceTableId: string;
  rangeHash: string;
  localDate: string;
  timeZone: string;
  containsNowPrecision: boolean;
  triggeredAtIso: string;
};

export type FieldBackfillStageChain = {
  /** Downstream stages executed strictly after all cursor batches of the current stage finish. */
  remainingStages: FieldBackfillStageEntry[];
  /** Accumulated table/field pairs to broadcast via TableActionTriggerRequested once final stage completes. */
  notifyTargets?: FieldBackfillStageEntry[];
  /** Periodic-refresh metadata settled strictly when the final stage commits or fails terminally. */
  periodicRefresh?: FieldBackfillPeriodicRefreshMeta;
};

export type FieldBackfillOutboxPayload = {
  taskType: 'field-backfill';
  baseId: string;
  tableId: string;
  fieldIds: string[];
  /** Estimated row count for complexity tracking */
  estimatedRowCount?: number;
  /** Last record id committed by the preceding cursor-ordered batch. */
  cursor?: string;
  /** Ordered downstream backfill stages for staged periodic/manual refresh cascades. */
  stageChain?: FieldBackfillStageChain;
};

/**
 * Input for creating a field backfill outbox task.
 */
export type FieldBackfillOutboxTaskInput = FieldBackfillOutboxPayload &
  TracePropagationCarrier & {
    runId: string;
    planHash: string;
    sourceChangedAt?: Date;
    stageDepth?: number;
    predecessorTaskId?: string;
  };

/**
 * Serialize domain objects to field backfill payload.
 */
export const serializeFieldBackfillPayload = (params: {
  baseId: BaseId;
  tableId: TableId;
  fieldIds: ReadonlyArray<FieldId>;
  estimatedRowCount?: number;
  cursor?: string;
  stageChain?: FieldBackfillStageChain;
}): FieldBackfillOutboxPayload => ({
  taskType: 'field-backfill',
  baseId: params.baseId.toString(),
  tableId: params.tableId.toString(),
  fieldIds: params.fieldIds.map((id) => id.toString()),
  estimatedRowCount: params.estimatedRowCount,
  cursor: params.cursor,
  ...(params.stageChain ? { stageChain: params.stageChain } : {}),
});

/**
 * Deserialize field backfill payload to domain objects.
 */
export const deserializeFieldBackfillPayload = (
  payload: FieldBackfillOutboxPayload
): Result<
  {
    baseId: BaseId;
    tableId: TableId;
    fieldIds: FieldId[];
    cursor?: string;
    stageChain?: FieldBackfillStageChain;
  },
  DomainError
> => {
  const baseIdResult = BaseId.create(payload.baseId);
  if (baseIdResult.isErr()) return err(baseIdResult.error);

  const tableIdResult = TableId.create(payload.tableId);
  if (tableIdResult.isErr()) return err(tableIdResult.error);

  const fieldIdsResult = payload.fieldIds.reduce<Result<FieldId[], DomainError>>(
    (acc, fieldId) =>
      acc.andThen((ids) =>
        FieldId.create(fieldId).map((id) => {
          ids.push(id);
          return ids;
        })
      ),
    ok([])
  );
  if (fieldIdsResult.isErr()) return err(fieldIdsResult.error);

  return ok({
    baseId: baseIdResult.value,
    tableId: tableIdResult.value,
    fieldIds: fieldIdsResult.value,
    cursor: payload.cursor,
    ...(payload.stageChain ? { stageChain: payload.stageChain } : {}),
  });
};

/**
 * Compute hash for field backfill payload (used for task deduplication).
 */
export const computeFieldBackfillHash = (
  payload: FieldBackfillOutboxPayload,
  hasher: IHasher
): string => {
  const hashInput = {
    taskType: payload.taskType,
    baseId: payload.baseId,
    tableId: payload.tableId,
    fieldIds: [...payload.fieldIds].sort((a, b) => Number(a > b) - Number(a < b)), // Sort for consistent hash
    cursor: payload.cursor,
    ...(payload.stageChain ? { stageChain: payload.stageChain } : {}),
  };
  return hasher.sha256(JSON.stringify(hashInput));
};

/**
 * Build outbox task input for field backfill.
 */
export const buildFieldBackfillTaskInput = (params: {
  baseId: BaseId;
  tableId: TableId;
  fieldIds: ReadonlyArray<FieldId>;
  hasher: IHasher;
  runId: string;
  estimatedRowCount?: number;
  cursor?: string;
  stageChain?: FieldBackfillStageChain;
  sourceChangedAt?: Date;
  stageDepth?: number;
  predecessorTaskId?: string;
  traceparent?: string;
  tracestate?: string;
}): FieldBackfillOutboxTaskInput => {
  const payload = serializeFieldBackfillPayload({
    baseId: params.baseId,
    tableId: params.tableId,
    fieldIds: params.fieldIds,
    estimatedRowCount: params.estimatedRowCount,
    cursor: params.cursor,
    stageChain: params.stageChain,
  });

  return {
    ...payload,
    runId: params.runId,
    sourceChangedAt: params.sourceChangedAt,
    stageDepth: params.stageDepth,
    predecessorTaskId: params.predecessorTaskId,
    traceparent: params.traceparent,
    tracestate: params.tracestate,
    planHash: computeFieldBackfillHash(payload, params.hasher),
  };
};

/**
 * Check if a payload is a field backfill task.
 */
export const isFieldBackfillPayload = (payload: unknown): payload is FieldBackfillOutboxPayload => {
  if (!payload || typeof payload !== 'object') return false;
  return (payload as { taskType?: string }).taskType === 'field-backfill';
};

/**
 * Coalesce table/field pairs preserving encounter order and deduplicating fieldIds per table.
 */
export const mergeStageNotificationTargets = (
  existing: ReadonlyArray<FieldBackfillStageEntry> | undefined,
  current?: FieldBackfillStageEntry
): FieldBackfillStageEntry[] => {
  const byTable = new Map<string, string[]>();
  const append = (entry?: FieldBackfillStageEntry) => {
    if (!entry || entry.fieldIds.length === 0) return;
    const prev = byTable.get(entry.tableId) ?? [];
    for (const fieldId of entry.fieldIds) {
      if (!prev.includes(fieldId)) {
        prev.push(fieldId);
      }
    }
    if (prev.length > 0) {
      byTable.set(entry.tableId, prev);
    }
  };
  for (const entry of existing ?? []) append(entry);
  append(current);
  return [...byTable.entries()].map(([tableId, fieldIds]) => ({ tableId, fieldIds }));
};

/**
 * Find and validate the next executable stage in a periodic refresh stage chain.
 */
export const takeNextValidBackfillStage = (
  remainingStages: ReadonlyArray<FieldBackfillStageEntry>
): {
  nextStage?: {
    tableId: TableId;
    fieldIds: FieldId[];
  };
  remainingStages: FieldBackfillStageEntry[];
} => {
  for (let i = 0; i < remainingStages.length; i += 1) {
    const entry = remainingStages[i]!;
    const tableIdResult = TableId.create(entry.tableId);
    if (tableIdResult.isErr()) continue;

    const validFieldIds: FieldId[] = [];
    for (const rawFieldId of entry.fieldIds) {
      const fieldIdResult = FieldId.create(rawFieldId);
      if (fieldIdResult.isOk() && !validFieldIds.some((id) => id.equals(fieldIdResult.value))) {
        validFieldIds.push(fieldIdResult.value);
      }
    }
    if (validFieldIds.length === 0) continue;

    return {
      nextStage: {
        tableId: tableIdResult.value,
        fieldIds: validFieldIds,
      },
      remainingStages: remainingStages.slice(i + 1).map((stage) => ({
        tableId: stage.tableId,
        fieldIds: [...stage.fieldIds],
      })),
    };
  }

  return { remainingStages: [] };
};
