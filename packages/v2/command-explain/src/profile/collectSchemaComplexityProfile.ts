import { FormulaField, type Table } from '@teable/v2-core';
import type {
  ComputedUpdatePlan,
  FieldDependencyGraphData,
} from '@teable/v2-adapter-table-repository-postgres';

import {
  buildSchemaComplexityProfile,
  buildSchemaComplexityStatistics,
  estimateOperationData,
  inspectFormulaProfile,
  type DataStatisticsSnapshot,
  type OperationDescriptor,
  type PlannerOperationPlan,
  type SchemaComplexityEdge,
  type SchemaComplexityAssumptions,
  type SchemaComplexityField,
  type SchemaComplexityProfile,
} from '@teable/v2-complexity';

const collectFields = (input: {
  readonly tables: ReadonlyArray<Table>;
  readonly graph: FieldDependencyGraphData;
}): Map<string, SchemaComplexityField> => {
  const fields = new Map<string, SchemaComplexityField>();
  for (const field of input.graph.fieldsById.values()) {
    fields.set(field.id.toString(), {
      id: field.id.toString(),
      tableId: field.tableId.toString(),
      type: field.type,
      isComputed: field.isComputed,
      conditional: field.conditionalOptions != null,
    });
  }
  for (const table of input.tables) {
    for (const field of table.getFields()) {
      fields.set(field.id().toString(), {
        id: field.id().toString(),
        tableId: table.id().toString(),
        type: field.type().toString(),
        isComputed: field.computed().toBoolean(),
        conditional: ['conditionalLookup', 'conditionalRollup'].includes(field.type().toString()),
        ...(field instanceof FormulaField
          ? { formula: inspectFormulaProfile(field.expression().toString()) }
          : {}),
      });
    }
  }
  return fields;
};

const collectEdges = (graph: FieldDependencyGraphData): ReadonlyArray<SchemaComplexityEdge> =>
  graph.edges.map((edge) => {
    const target = graph.fieldsById.get(edge.toFieldId.toString());
    return {
      fromFieldId: edge.fromFieldId.toString(),
      toFieldId: edge.toFieldId.toString(),
      fromTableId: edge.fromTableId.toString(),
      toTableId: edge.toTableId.toString(),
      kind: edge.kind,
      linkFieldId: edge.linkFieldId?.toString(),
      conditional: target?.conditionalOptions != null,
      conditionFieldIds: target?.conditionalOptions?.conditionFieldIds,
    };
  });

const projectPlan = (
  plan: ComputedUpdatePlan,
  beforeImage: OperationDescriptor['beforeImage']
): PlannerOperationPlan => ({
  steps: plan.steps.map((step) => ({
    tableId: step.tableId.toString(),
    fieldIds: step.fieldIds.map((id) => id.toString()),
    level: step.level,
  })),
  paths: plan.edges.map((edge) => {
    const sources = edge.propagationSourceFieldIds?.length
      ? edge.propagationSourceFieldIds
      : [edge.fromFieldId];
    const targets = edge.propagationTargetFieldIds?.length
      ? edge.propagationTargetFieldIds
      : [edge.toFieldId];
    return {
      fromFieldId: sources[0]!.toString(),
      toFieldId: targets[0]!.toString(),
      fromTableId: edge.fromTableId.toString(),
      toTableId: edge.toTableId.toString(),
      mode: edge.propagationMode ?? (edge.linkFieldId ? 'linkTraversal' : 'allTargetRecords'),
      origin: 'dependency',
      reason: edge.allTargetRecordsReasons?.join(','),
      sourceFieldIds: sources.map((id) => id.toString()),
      targetFieldIds: targets.map((id) => id.toString()),
      sourceFieldCount: sources.length,
      targetFieldCount: targets.length,
    };
  }),
  seedAllTableIds: plan.seedAllTableIds?.map((id) => id.toString()),
  cycle: plan.cycleInfo !== undefined,
  truncated: plan.partialStageBudget !== undefined,
  beforeImage:
    (plan.beforeImageRecords?.length ?? 0) > 0 ? 'available' : (beforeImage ?? 'unknown'),
});

export type PreparedSchemaComplexityInput = {
  readonly fields: ReadonlyArray<SchemaComplexityField>;
  readonly edges: ReadonlyArray<SchemaComplexityEdge>;
};

/** Build the expensive field/formula model once for a multi-cell matrix. */
export const prepareSchemaComplexityInput = (input: {
  readonly tables: ReadonlyArray<Table>;
  readonly graph: FieldDependencyGraphData;
}): PreparedSchemaComplexityInput => ({
  fields: [...collectFields(input).values()],
  edges: collectEdges(input.graph),
});

/**
 * Metadata-only adapter. Loading tables/graphs and obtaining a planner DTO remain
 * the caller's responsibility; this collector never queries records or PostgreSQL.
 * A partial graph is not promoted to a complete table/base profile.
 */
export function collectSchemaComplexityProfile(input: {
  readonly tables: ReadonlyArray<Table>;
  readonly graph: FieldDependencyGraphData;
  readonly operation?: OperationDescriptor;
  readonly plan?: ComputedUpdatePlan;
  readonly completeness?: 'complete' | 'partial' | 'truncated';
  readonly focusTableId?: string;
  /** Opt-in Phase 2 statistics. Absence keeps the estimate not-estimated. */
  readonly statistics?: DataStatisticsSnapshot | null;
  /** Caller assumptions; used only when `statistics` is not supplied. */
  readonly assumptions?: SchemaComplexityAssumptions;
  readonly seedRecordCount?: number | null;
  /** Reuse a prepared schema model across matrix cells. */
  readonly preparedSchema?: PreparedSchemaComplexityInput;
}): SchemaComplexityProfile {
  const schemaFields = input.preparedSchema?.fields ?? [...collectFields(input).values()];
  const schemaEdges = input.preparedSchema?.edges ?? collectEdges(input.graph);
  const operation = input.operation
    ? {
        ...input.operation,
        ...(input.plan ? { plan: projectPlan(input.plan, input.operation.beforeImage) } : {}),
      }
    : undefined;
  const focusTableId = input.focusTableId ?? input.operation?.tableId;

  const profile = buildSchemaComplexityProfile({
    fields: schemaFields,
    edges: schemaEdges,
    ...(focusTableId ? { focusTableId } : {}),
    operation,
    completeness: input.completeness ?? 'partial',
  });

  if (profile.operation === null) return profile;
  const statistics =
    input.statistics ??
    (input.assumptions
      ? buildSchemaComplexityStatistics(schemaFields, schemaEdges, operation!, input.assumptions)
          .statistics
      : null);
  if (statistics == null) return profile;
  return {
    ...profile,
    dataEstimate: estimateOperationData({
      operation: profile.operation,
      statistics,
      seedRecordCount: input.seedRecordCount ?? input.assumptions?.seedRecordCount ?? null,
    }),
  };
}
