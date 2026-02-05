import type {
  ComputedUpdatePlan,
  FieldDependencyGraphData,
} from '@teable/v2-adapter-table-repository-postgres';
import type { FieldId, Table, TableId } from '@teable/v2-core';

import type {
  ComputedUpdateReason,
  ComputedUpdateSeedField,
  ComputedUpdateTargetField,
  ComputedUpdateDependency,
} from '../types';

type BuildComputedUpdateReasonParams = {
  plan: ComputedUpdatePlan;
  graphData: FieldDependencyGraphData;
  tableById: Map<string, Table>;
  changedFieldIds: ReadonlyArray<FieldId>;
  targetFieldIds: ReadonlyArray<FieldId>;
  changeType: ComputedUpdatePlan['changeType'];
};

type GraphEdge = FieldDependencyGraphData['edges'][number];

const buildEdgesByTarget = (
  edges: ReadonlyArray<GraphEdge>,
  targetFieldIdSet: ReadonlySet<string>
): Map<string, GraphEdge[]> => {
  const edgesByTarget = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    const targetId = edge.toFieldId.toString();
    if (!targetFieldIdSet.has(targetId)) continue;
    const existing = edgesByTarget.get(targetId) ?? [];
    existing.push(edge);
    edgesByTarget.set(targetId, existing);
  }
  return edgesByTarget;
};

const pickPreferredEdges = (targetEdges: ReadonlyArray<GraphEdge>): ReadonlyArray<GraphEdge> => {
  const preferredSemanticGroups = new Set<string>();
  for (const edge of targetEdges) {
    if (edge.semantic && edge.semantic !== 'formula_ref') {
      preferredSemanticGroups.add(`${edge.fromFieldId.toString()}|${edge.kind}`);
    }
  }

  const filtered = targetEdges.filter((edge) => {
    if (edge.semantic !== 'formula_ref') return true;
    const key = `${edge.fromFieldId.toString()}|${edge.kind}`;
    return !preferredSemanticGroups.has(key);
  });

  const deduped = new Map<string, GraphEdge>();
  for (const edge of filtered) {
    const linkKey = edge.linkFieldId?.toString() ?? '';
    const key = `${edge.fromFieldId.toString()}|${edge.kind}|${linkKey}`;
    if (!deduped.has(key)) {
      deduped.set(key, edge);
    }
  }

  return [...deduped.values()];
};

const collectSeededDependencyIds = (targetFields: ReadonlyArray<ComputedUpdateTargetField>) => {
  const seededDependencyIds = new Set<string>();
  for (const target of targetFields) {
    for (const dep of target.dependencies) {
      if (dep.isSeed) {
        seededDependencyIds.add(dep.fromFieldId);
      }
    }
  }
  return seededDependencyIds;
};

const collectImplicitLinkSeedIds = (params: {
  targetFieldIds: ReadonlyArray<FieldId>;
  fieldsById: FieldDependencyGraphData['fieldsById'];
  seedFieldIdSet: ReadonlySet<string>;
}) => {
  const implicitLinkSeedIds = new Set<string>();
  for (const fieldId of params.targetFieldIds) {
    const meta = params.fieldsById.get(fieldId.toString());
    if (!meta || meta.type !== 'link') continue;
    const targetId = fieldId.toString();
    if (params.seedFieldIdSet.has(targetId)) {
      implicitLinkSeedIds.add(targetId);
    }
    const symmetricFieldId = meta.options?.symmetricFieldId;
    if (symmetricFieldId && params.seedFieldIdSet.has(symmetricFieldId)) {
      implicitLinkSeedIds.add(symmetricFieldId);
    }
  }
  return implicitLinkSeedIds;
};

const buildNotes = (params: {
  changeType: ComputedUpdatePlan['changeType'];
  seedFieldCount: number;
}): string[] => {
  const notes: string[] = [];
  if (params.changeType === 'insert') {
    notes.push('Insert computes stored computed fields in the seed table for initial values.');
  }
  if (params.changeType === 'delete') {
    notes.push('Delete recomputes computed fields impacted by link relation changes.');
  }
  if (params.seedFieldCount === 0 && params.changeType === 'update') {
    notes.push('No changed fields directly matched dependency edges for this batch.');
  }
  return notes;
};

export const buildComputedUpdateReason = (
  params: BuildComputedUpdateReasonParams
): ComputedUpdateReason => {
  const { plan, graphData, tableById, changedFieldIds, targetFieldIds, changeType } = params;
  const { fieldsById, edges } = graphData;

  const resolveTableName = (tableId: TableId): string => {
    const table = tableById.get(tableId.toString());
    return table ? table.name().toString() : tableId.toString();
  };

  const resolveFieldName = (tableId: TableId, fieldId: FieldId): string => {
    const table = tableById.get(tableId.toString());
    if (table) {
      const fieldResult = table.getField((f) => f.id().equals(fieldId));
      if (fieldResult.isOk()) {
        return fieldResult.value.name().toString();
      }
    }
    return fieldId.toString();
  };

  const resolveFieldType = (fieldId: FieldId): string =>
    fieldsById.get(fieldId.toString())?.type ?? 'unknown';

  const seedFieldIdSet = new Set(changedFieldIds.map((id) => id.toString()));
  const targetFieldIdSet = new Set(targetFieldIds.map((id) => id.toString()));
  const edgesByTarget = buildEdgesByTarget(edges, targetFieldIdSet);

  const targetFields: ComputedUpdateTargetField[] = targetFieldIds.map((fieldId) => {
    const meta = fieldsById.get(fieldId.toString());
    const tableId = meta?.tableId ?? plan.seedTableId;
    const dependencies: ComputedUpdateDependency[] = pickPreferredEdges(
      edgesByTarget.get(fieldId.toString()) ?? []
    ).map((edge) => ({
      fromFieldId: edge.fromFieldId.toString(),
      fromFieldName: resolveFieldName(edge.fromTableId, edge.fromFieldId),
      fromFieldType: resolveFieldType(edge.fromFieldId),
      fromTableId: edge.fromTableId.toString(),
      fromTableName: resolveTableName(edge.fromTableId),
      kind: edge.kind,
      semantic: edge.semantic,
      linkFieldId: edge.linkFieldId?.toString(),
      isSeed: seedFieldIdSet.has(edge.fromFieldId.toString()),
    }));

    return {
      fieldId: fieldId.toString(),
      fieldName: resolveFieldName(tableId, fieldId),
      fieldType: meta?.type ?? 'unknown',
      tableId: tableId.toString(),
      tableName: resolveTableName(tableId),
      dependencies,
    };
  });

  const seededDependencyIds = collectSeededDependencyIds(targetFields);
  const implicitLinkSeedIds = collectImplicitLinkSeedIds({
    targetFieldIds,
    fieldsById,
    seedFieldIdSet,
  });
  const effectiveSeedIds = new Set<string>([...seededDependencyIds, ...implicitLinkSeedIds]);
  const seedFields: ComputedUpdateSeedField[] = changedFieldIds
    .filter((fieldId) => effectiveSeedIds.has(fieldId.toString()))
    .map((fieldId) => {
      const meta = fieldsById.get(fieldId.toString());
      const tableId = meta?.tableId ?? plan.seedTableId;
      return {
        fieldId: fieldId.toString(),
        fieldName: resolveFieldName(tableId, fieldId),
        fieldType: meta?.type ?? 'unknown',
        tableId: tableId.toString(),
        tableName: resolveTableName(tableId),
        impact: meta?.type === 'link' ? 'link_relation' : 'value',
      };
    });

  const notes = buildNotes({ changeType, seedFieldCount: seedFields.length });

  return {
    changeType,
    seedFields,
    targetFields,
    notes,
  };
};
