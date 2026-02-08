import {
  BaseId,
  domainError,
  FieldId,
  TableId,
  type DomainError,
  type IHasher,
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
export type FieldBackfillOutboxPayload = {
  taskType: 'field-backfill';
  baseId: string;
  tableId: string;
  fieldIds: string[];
  /** Estimated row count for complexity tracking */
  estimatedRowCount?: number;
};

/**
 * Input for creating a field backfill outbox task.
 */
export type FieldBackfillOutboxTaskInput = FieldBackfillOutboxPayload & {
  runId: string;
  planHash: string;
};

/**
 * Serialize domain objects to field backfill payload.
 */
export const serializeFieldBackfillPayload = (params: {
  baseId: BaseId;
  tableId: TableId;
  fieldIds: ReadonlyArray<FieldId>;
  estimatedRowCount?: number;
}): FieldBackfillOutboxPayload => ({
  taskType: 'field-backfill',
  baseId: params.baseId.toString(),
  tableId: params.tableId.toString(),
  fieldIds: params.fieldIds.map((id) => id.toString()),
  estimatedRowCount: params.estimatedRowCount,
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
    fieldIds: [...payload.fieldIds].sort(), // Sort for consistent hash
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
}): FieldBackfillOutboxTaskInput => {
  const payload = serializeFieldBackfillPayload({
    baseId: params.baseId,
    tableId: params.tableId,
    fieldIds: params.fieldIds,
    estimatedRowCount: params.estimatedRowCount,
  });

  return {
    ...payload,
    runId: params.runId,
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
