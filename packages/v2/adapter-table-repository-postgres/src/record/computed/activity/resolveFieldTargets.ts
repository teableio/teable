import { FieldId, TableId, type DomainError, type FieldComputeTarget } from '@teable/v2-core';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { ComputedUpdatePlan } from '../ComputedUpdatePlanner';

import type { AnyOutboxItem } from '../outbox/IComputedUpdateOutbox';
import { isFieldBackfillOutboxItem, isSeedOutboxItem } from '../outbox/IComputedUpdateOutbox';
type RawFieldComputeTarget = { fieldId: string; tableId: string };

const resolveTargets = (
  rawTargets: ReadonlyArray<RawFieldComputeTarget>
): Result<FieldComputeTarget[], DomainError> => {
  const targets: FieldComputeTarget[] = [];
  for (const rawTarget of rawTargets) {
    const target = FieldId.create(rawTarget.fieldId).andThen((fieldId) =>
      TableId.create(rawTarget.tableId).map((tableId) => ({ fieldId, tableId }))
    );
    if (target.isErr()) return err(target.error);
    targets.push(target.value);
  }
  return ok(targets);
};

export const resolveFieldTargetsFromPlan = (
  plan: Pick<ComputedUpdatePlan, 'steps'>
): FieldComputeTarget[] => {
  const targets = new Map<string, FieldComputeTarget>();
  for (const step of plan.steps) {
    for (const fieldId of step.fieldIds) {
      const key = `${step.tableId.toString()}:${fieldId.toString()}`;
      if (!targets.has(key)) {
        targets.set(key, { fieldId, tableId: step.tableId });
      }
    }
  }
  return [...targets.values()];
};

/**
 * Resolve (fieldId, tableId) pairs for a computed outbox task.
 * Prefer step-level field placements; fall back to seed/table + affectedFieldIds.
 */
export const resolveFieldTargetsFromOutboxItem = (
  task: AnyOutboxItem
): Result<FieldComputeTarget[], DomainError> => {
  if (isFieldBackfillOutboxItem(task)) {
    return resolveTargets(task.fieldIds.map((fieldId) => ({ fieldId, tableId: task.tableId })));
  }

  if (isSeedOutboxItem(task)) {
    // Seed payloads contain changed input fields, not the computed fields that will run.
    // The worker registers accurate targets after planning and before executing the seed task.
    return ok([]);
  }

  const byField = new Map<string, string>();
  for (const step of task.steps ?? []) {
    for (const fieldId of step.fieldIds ?? []) {
      if (!byField.has(fieldId)) {
        byField.set(fieldId, step.tableId);
      }
    }
  }

  if (byField.size > 0) {
    return resolveTargets(
      [...byField.entries()].map(([fieldId, tableId]) => ({ fieldId, tableId }))
    );
  }

  return resolveTargets(
    (task.affectedFieldIds ?? []).map((fieldId) => ({
      fieldId,
      tableId: task.seedTableId,
    }))
  );
};
export const sumDirtyRecordCount = (
  dirtyStats: ReadonlyArray<{ recordCount?: number }> | undefined
): number => {
  if (!dirtyStats?.length) return 0;
  return dirtyStats.reduce((sum, row) => sum + Math.max(0, Math.trunc(row.recordCount ?? 0)), 0);
};

export const hasAllTargetRecordsEdge = (
  edges: ReadonlyArray<{ propagationMode?: string }> | undefined
): boolean => edges?.some((edge) => edge.propagationMode === 'allTargetRecords') === true;
