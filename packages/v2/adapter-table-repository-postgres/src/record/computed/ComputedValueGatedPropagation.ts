import type { Table } from '@teable/v2-core';

import { supportsValueFrontier } from './ComputedChangeFrontier';
import type { StepChangeData } from './ComputedFieldUpdater';
import type { ComputedDependencyEdge, ComputedUpdatePlan } from './ComputedUpdatePlanner';

export const isStructurallyPrunableLinkEdge = (edge: ComputedDependencyEdge): boolean =>
  edge.propagationMode === 'linkTraversal' &&
  Boolean(edge.linkFieldId) &&
  !edge.toTableId.equals(edge.fromTableId) &&
  !edge.filterCondition &&
  (edge.propagationSourceFieldIds?.length ?? 0) > 0;

export const isValueGatedLinkEdge = (
  edge: ComputedDependencyEdge,
  plan: Pick<ComputedUpdatePlan, 'steps'>,
  tables: ReadonlyMap<string, Table>
): boolean => {
  if (!isStructurallyPrunableLinkEdge(edge)) return false;
  const sourceFieldIds = edge.propagationSourceFieldIds ?? [];
  if (
    !sourceFieldIds.every((sourceId) =>
      plan.steps.some((step) => step.fieldIds.some((fieldId) => fieldId.equals(sourceId)))
    )
  ) {
    return false;
  }
  const table = tables.get(edge.fromTableId.toString());
  if (!table) return false;
  return sourceFieldIds.every((sourceId) => {
    const field = table.getFields((candidate) => candidate.id().equals(sourceId))[0];
    return field !== undefined && supportsValueFrontier(field, table);
  });
};

export const fieldChangeActuallyChanged = (change: {
  oldValue?: unknown;
  newValue: unknown;
}): boolean => change.oldValue === undefined || !Object.is(change.oldValue, change.newValue);

export const recordIdsChangedForFields = (
  changesByStep: ReadonlyArray<StepChangeData>,
  fieldIds: ReadonlySet<string>
): string[] => {
  if (fieldIds.size === 0) return [];
  const recordIds = new Set<string>();
  for (const step of changesByStep) {
    for (const record of step.recordChanges) {
      if (
        record.changes.some(
          (change) => fieldIds.has(change.fieldId) && fieldChangeActuallyChanged(change)
        )
      ) {
        recordIds.add(record.recordId);
      }
    }
  }
  return [...recordIds].sort();
};
