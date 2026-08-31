import type { FieldId } from '@teable/v2-core';

import type { StepChangeData } from './ComputedFieldUpdater';
import type { ComputedUpdatePlan, UpdateStep } from './ComputedUpdatePlanner';

/**
 * Fields that may start the next cascade stage.
 *
 * Executed steps continue only from values that were actually changed by the
 * UPDATE. This makes an unchanged recomputation a fixed point instead of
 * feeding every planned field back into reciprocal link edges forever.
 * Propagation-only stages have no UPDATE changes to inspect, so their edge
 * targets are the outputs that must be computed next.
 *
 * Rejected (oversized, reverted) cells count as changed even though their
 * change entries were stripped: dependents computed in the same collapsed
 * statement read the pre-revert value, so they must recompute from the
 * reverted stored value in the next stage. The rejected field itself is a
 * seed, not a target, so its oversized computation does not re-run.
 */
export const collectContinuationFieldIds = (
  plan: ComputedUpdatePlan,
  changesByStep: ReadonlyArray<StepChangeData>,
  rejectedCells?: ReadonlyArray<{ fieldId: string }>
): FieldId[] => {
  if (plan.steps.length === 0) {
    const edgeTargets = new Map<string, FieldId>();
    for (const edge of plan.edges) {
      for (const fieldId of edge.propagationTargetFieldIds ?? [edge.toFieldId]) {
        edgeTargets.set(fieldId.toString(), fieldId);
      }
    }
    return [...edgeTargets.values()];
  }

  const plannedFields = new Map<string, FieldId>();
  for (const step of plan.steps) {
    for (const fieldId of step.fieldIds) plannedFields.set(fieldId.toString(), fieldId);
  }

  const changedFields = new Map<string, FieldId>();
  for (const stepChange of changesByStep) {
    for (const recordChange of stepChange.recordChanges) {
      for (const change of recordChange.changes) {
        const fieldId = plannedFields.get(change.fieldId);
        if (fieldId) changedFields.set(change.fieldId, fieldId);
      }
    }
  }
  for (const rejected of rejectedCells ?? []) {
    const fieldId = plannedFields.get(rejected.fieldId);
    if (fieldId) changedFields.set(rejected.fieldId, fieldId);
  }
  return [...changedFields.values()];
};

/**
 * After a multi-level stage commits, continue only from the terminal executed
 * level. Intermediate lookup/formula fields already ran in this transaction;
 * feeding them back into planNextStage re-queues the same formulas (the
 * JSON-formula-cascade double-compute). Single-level stages keep the full
 * changed set so delete/import discovery still sees lookup outputs.
 */
export const collectContinuationFieldIdsFromExecutedSteps = (
  plan: ComputedUpdatePlan,
  executedSteps: ReadonlyArray<UpdateStep>,
  changesByStep: ReadonlyArray<StepChangeData>,
  rejectedCells?: ReadonlyArray<{ fieldId: string }>
): FieldId[] => {
  const levels = [...new Set(executedSteps.map((step) => step.level))];
  if (levels.length <= 1) {
    return collectContinuationFieldIds(
      executedSteps.length > 0 ? { ...plan, steps: executedSteps } : plan,
      changesByStep,
      rejectedCells
    );
  }
  const terminalLevel = Math.max(...levels);
  const terminalSteps = executedSteps.filter((step) => step.level === terminalLevel);
  const ids = new Map(
    collectContinuationFieldIds({ ...plan, steps: terminalSteps, edges: [] }, changesByStep).map(
      (fieldId) => [fieldId.toString(), fieldId] as const
    )
  );
  // Rejected (reverted) cells bypass the terminal-level cut: dependents of an
  // intermediate rejected field consumed the pre-revert value in this
  // transaction, so unlike other intermediate outputs they must re-run.
  if (rejectedCells?.length) {
    const executedFields = new Map<string, FieldId>();
    for (const step of executedSteps) {
      for (const fieldId of step.fieldIds) executedFields.set(fieldId.toString(), fieldId);
    }
    for (const rejected of rejectedCells) {
      const fieldId = executedFields.get(rejected.fieldId);
      if (fieldId) ids.set(rejected.fieldId, fieldId);
    }
  }
  return [...ids.values()];
};
