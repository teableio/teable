import {
  BaseId,
  domainError,
  FieldId,
  type DomainError,
  type RecordId,
  type Table,
  TableId,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { v2RecordRepositoryPostgresTokens } from '../di/tokens';
import type { FieldDependencyEdge, FieldDependencyGraph, FieldMeta } from './FieldDependencyGraph';

export type UpdateContext = {
  table: Table;
  changedFieldIds: ReadonlyArray<FieldId>;
  changedRecordIds: ReadonlyArray<RecordId>;
  changeType: 'insert' | 'update' | 'delete';
  impact?: UpdateImpactHint;
};

export type ComputedSeedGroup = {
  tableId: TableId;
  recordIds: ReadonlyArray<RecordId>;
};

export type PlanStageContext = {
  baseId: BaseId;
  seedTableId: TableId;
  seedRecordIds: ReadonlyArray<RecordId>;
  extraSeedRecords: ReadonlyArray<ComputedSeedGroup>;
  changedFieldIds: ReadonlyArray<FieldId>;
  changeType: 'insert' | 'update' | 'delete';
  impact?: UpdateImpactHint;
};

export type UpdateImpactHint = {
  valueFieldIds: ReadonlyArray<FieldId>;
  linkFieldIds: ReadonlyArray<FieldId>;
};

export type UpdateStep = {
  tableId: TableId;
  fieldIds: ReadonlyArray<FieldId>;
  level: number;
};

/**
 * A batch of same-table steps that can be executed together using CTE.
 * All steps in a batch are in the same table and only have same_record dependencies.
 */
export type SameTableBatch = {
  tableId: TableId;
  /** Steps ordered by level (dependency order) */
  steps: ReadonlyArray<UpdateStep>;
  /** The minimum level in this batch */
  minLevel: number;
  /** The maximum level in this batch */
  maxLevel: number;
};

export type ComputedDependencyEdge = {
  fromFieldId: FieldId;
  toFieldId: FieldId;
  fromTableId: TableId;
  toTableId: TableId;
  linkFieldId?: FieldId;
  order: number;
};

export type ComputedUpdatePlan = {
  baseId: BaseId;
  seedTableId: TableId;
  seedRecordIds: ReadonlyArray<RecordId>;
  extraSeedRecords: ReadonlyArray<ComputedSeedGroup>;
  steps: ReadonlyArray<UpdateStep>;
  edges: ReadonlyArray<ComputedDependencyEdge>;
  estimatedComplexity: number;
  changeType: UpdateContext['changeType'];
  /**
   * Same-table batches that can be executed using CTE optimization.
   * Batches are derived from steps by identifying consecutive same-table steps
   * that only have same_record dependencies between them.
   */
  sameTableBatches: ReadonlyArray<SameTableBatch>;
};

type UpdateImpact = {
  includesLinkRelation: boolean;
  includesValueChange: boolean;
  valueSeedFieldIds: ReadonlyArray<FieldId>;
  linkSeedFieldIds: ReadonlyArray<FieldId>;
};

type UpdateImpactContext = Pick<UpdateContext, 'changedFieldIds' | 'changeType' | 'impact'>;

/**
 * Build an ordered update plan for computed fields (formula/lookup/rollup/link).
 *
 * Example
 * ```typescript
 * const plan = await planner.plan({
 *   table,
 *   changedFieldIds: [nameFieldId],
 *   changedRecordIds: [recordId],
 *   changeType: 'update',
 * });
 * // plan.steps are ordered by dependency level
 * ```
 */
@injectable()
export class ComputedUpdatePlanner {
  constructor(
    @inject(v2RecordRepositoryPostgresTokens.computedDependencyGraph)
    private readonly graph: FieldDependencyGraph
  ) {}

  async plan(context: UpdateContext): Promise<Result<ComputedUpdatePlan, DomainError>> {
    return this.planStage({
      baseId: context.table.baseId(),
      seedTableId: context.table.id(),
      seedRecordIds: context.changedRecordIds,
      extraSeedRecords: [],
      changedFieldIds: context.changedFieldIds,
      changeType: context.changeType,
      impact: context.impact,
    });
  }

  async planStage(context: PlanStageContext): Promise<Result<ComputedUpdatePlan, DomainError>> {
    return safeTry<ComputedUpdatePlan, DomainError>(
      async function* (this: ComputedUpdatePlanner) {
        const graphData = yield* await this.graph.load(context.baseId);
        const { fieldsById, edges } = graphData;

        const impactResult = resolveUpdateImpact(fieldsById, context);
        if (impactResult.isErr()) return err(impactResult.error);
        const impact = impactResult.value;

        const valueSeedFieldIds = new Map<string, FieldId>();
        for (const fieldId of impact.valueSeedFieldIds) {
          valueSeedFieldIds.set(fieldId.toString(), fieldId);
        }
        const linkSeedFieldIds = new Map<string, FieldId>();
        for (const fieldId of impact.linkSeedFieldIds) {
          linkSeedFieldIds.set(fieldId.toString(), fieldId);
        }

        // Link relation changes should also refresh symmetric link fields and their dependents.
        const symmetricLinkEdges: Array<{
          fromFieldId: FieldId;
          toFieldId: FieldId;
          fromTableId: TableId;
          toTableId: TableId;
        }> = [];

        if (impact.includesLinkRelation) {
          for (const linkFieldId of impact.linkSeedFieldIds) {
            const meta = fieldsById.get(linkFieldId.toString());
            if (!meta || meta.type !== 'link') continue;

            const symmetricFieldId = meta.options?.symmetricFieldId;
            const foreignTableId = meta.options?.foreignTableId;
            if (!symmetricFieldId || !foreignTableId) continue;

            const symmetricFieldResult = FieldId.create(symmetricFieldId);
            if (symmetricFieldResult.isErr()) return err(symmetricFieldResult.error);
            const foreignTableResult = TableId.create(foreignTableId);
            if (foreignTableResult.isErr()) return err(foreignTableResult.error);

            const symmetricKey = symmetricFieldResult.value.toString();
            if (!fieldsById.has(symmetricKey)) continue;
            symmetricLinkEdges.push({
              fromFieldId: meta.id,
              toFieldId: symmetricFieldResult.value,
              fromTableId: meta.tableId,
              toTableId: foreignTableResult.value,
            });
          }
        }

        const affectedFieldIds = new Set<string>();
        if (impact.includesValueChange && valueSeedFieldIds.size > 0) {
          const valueEdges = edges.filter(isEdgeRelevantForValue);
          for (const fieldId of collectDirectAffectedFieldIds(valueEdges, [
            ...valueSeedFieldIds.values(),
          ])) {
            affectedFieldIds.add(fieldId);
          }
        }
        if (impact.includesLinkRelation && linkSeedFieldIds.size > 0) {
          const linkEdges = edges.filter(isEdgeRelevantForLink);
          for (const fieldId of collectDirectAffectedFieldIds(linkEdges, [
            ...linkSeedFieldIds.values(),
          ])) {
            affectedFieldIds.add(fieldId);
          }
          for (const fieldId of linkSeedFieldIds.values()) {
            affectedFieldIds.add(fieldId.toString());
          }
          for (const edge of symmetricLinkEdges) {
            affectedFieldIds.add(edge.toFieldId.toString());
          }
        }

        const relevantEdges = edges.filter(
          (edge) =>
            (impact.includesValueChange && isEdgeRelevantForValue(edge)) ||
            (impact.includesLinkRelation && isEdgeRelevantForLink(edge))
        );
        const computedFieldIds = filterComputedFields(fieldsById, affectedFieldIds);

        if (computedFieldIds.size === 0) {
          return ok({
            baseId: context.baseId,
            seedTableId: context.seedTableId,
            seedRecordIds: context.seedRecordIds,
            extraSeedRecords: context.extraSeedRecords,
            steps: [],
            edges: [],
            estimatedComplexity: 0,
            changeType: context.changeType,
            sameTableBatches: [],
          });
        }

        const { ordered, levels } = topoSort(relevantEdges, computedFieldIds);
        if (ordered.length !== computedFieldIds.size) {
          return err(
            domainError.conflict({
              message: 'Computed field dependency cycle detected',
            })
          );
        }

        const steps = yield* buildSteps(ordered, levels, fieldsById);
        const propagationEdges = yield* buildPropagationEdges(
          relevantEdges,
          fieldsById,
          computedFieldIds,
          levels,
          symmetricLinkEdges
        );

        // Build same-table batches for CTE optimization
        const sameTableBatches = buildSameTableBatches(steps, relevantEdges);

        const seedRecordCount = countSeedRecords(context.seedRecordIds, context.extraSeedRecords);
        const estimatedComplexity = steps.length + propagationEdges.length + seedRecordCount;

        return ok({
          baseId: context.baseId,
          seedTableId: context.seedTableId,
          seedRecordIds: context.seedRecordIds,
          extraSeedRecords: context.extraSeedRecords,
          steps,
          edges: propagationEdges,
          estimatedComplexity,
          changeType: context.changeType,
          sameTableBatches,
        });
      }.bind(this)
    );
  }
}

const resolveUpdateImpact = (
  fieldsById: Map<string, FieldMeta>,
  context: UpdateImpactContext
): Result<UpdateImpact, DomainError> => {
  if (context.impact) {
    const valueSeedFieldIds = context.impact.valueFieldIds;
    const linkSeedFieldIds = context.impact.linkFieldIds;
    return ok({
      includesLinkRelation: linkSeedFieldIds.length > 0 || context.changeType === 'delete',
      includesValueChange: valueSeedFieldIds.length > 0 || context.changeType === 'delete',
      valueSeedFieldIds,
      linkSeedFieldIds,
    });
  }

  // Split change impact into value changes vs link-relation changes.
  const valueSeedFieldIds: FieldId[] = [];
  const linkSeedFieldIds: FieldId[] = [];
  let includesValueChange = false;
  let includesLinkRelation = false;

  for (const fieldId of context.changedFieldIds) {
    const meta = fieldsById.get(fieldId.toString());
    if (!meta) continue;
    if (meta.type === 'link') {
      includesLinkRelation = true;
      linkSeedFieldIds.push(meta.id);
      continue;
    }
    includesValueChange = true;
    valueSeedFieldIds.push(fieldId);
  }

  if (context.changeType === 'delete') {
    includesValueChange = true;
    includesLinkRelation = includesLinkRelation || linkSeedFieldIds.length > 0;
  }

  return ok({
    includesLinkRelation,
    includesValueChange,
    valueSeedFieldIds,
    linkSeedFieldIds,
  });
};

/**
 * Value changes propagate through all edges (both same_record and cross_record).
 * When a field's value changes, all dependent fields need to be updated.
 */
const isEdgeRelevantForValue = (edge: FieldDependencyEdge): boolean =>
  // All edge types are relevant for value changes - both same_record (formula in same table)
  // and cross_record (lookup/link title from foreign table) need updates.
  edge.kind === 'same_record' || edge.kind === 'cross_record';

/**
 * Link relation changes only propagate through edges that depend on the link relationship.
 * This includes:
 * - same_record edges where semantic is 'lookup_link' (lookup depends on which link)
 * - Symmetric link updates (handled separately)
 *
 * Note: For link relation changes, we DON'T propagate through 'link_title' or 'lookup_source'
 * edges because those depend on values, not relationships.
 */
const isEdgeRelevantForLink = (edge: FieldDependencyEdge): boolean =>
  // Only edges that depend on link relationships, not values
  edge.kind === 'same_record' && edge.semantic === 'lookup_link';

/**
 * Collect all transitively affected field IDs starting from the seed fields.
 *
 * Uses BFS to traverse the dependency graph and find all fields that depend on
 * the seed fields, directly or transitively.
 */
const collectDirectAffectedFieldIds = (
  edges: ReadonlyArray<FieldDependencyEdge>,
  seedFieldIds: ReadonlyArray<FieldId>
): Set<string> => {
  // Build adjacency list for efficient traversal
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const from = edge.fromFieldId.toString();
    const to = edge.toFieldId.toString();
    if (!adjacency.has(from)) {
      adjacency.set(from, []);
    }
    adjacency.get(from)!.push(to);
  }

  // BFS to find all transitively affected fields
  const visited = new Set<string>();
  const queue: string[] = seedFieldIds.map((id) => id.toString());

  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbors = adjacency.get(current) ?? [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  return visited;
};

const filterComputedFields = (
  fieldsById: Map<string, FieldMeta>,
  affectedFieldIds: Set<string>
): Set<string> => {
  const computedTypes = new Set(['formula', 'lookup', 'rollup', 'link']);
  const computed = new Set<string>();
  for (const fieldId of affectedFieldIds) {
    const meta = fieldsById.get(fieldId);
    if (!meta) continue;
    if (computedTypes.has(meta.type)) {
      computed.add(fieldId);
    }
  }
  return computed;
};

const countSeedRecords = (
  seedRecordIds: ReadonlyArray<RecordId>,
  extraSeedRecords: ReadonlyArray<ComputedSeedGroup>
): number => {
  let count = seedRecordIds.length;
  for (const group of extraSeedRecords) {
    count += group.recordIds.length;
  }
  return count;
};

export const splitSeedGroupsForPlan = (
  seedGroups: ReadonlyArray<ComputedSeedGroup>,
  preferredTableId?: TableId
): {
  seedTableId: TableId;
  seedRecordIds: ReadonlyArray<RecordId>;
  extraSeedRecords: ReadonlyArray<ComputedSeedGroup>;
} | null => {
  const nonEmpty = seedGroups.filter((group) => group.recordIds.length > 0);
  if (nonEmpty.length === 0) return null;

  const primary =
    preferredTableId === undefined
      ? nonEmpty[0]
      : nonEmpty.find((group) => group.tableId.equals(preferredTableId)) ?? nonEmpty[0];

  return {
    seedTableId: primary.tableId,
    seedRecordIds: primary.recordIds,
    extraSeedRecords: nonEmpty.filter((group) => group !== primary),
  };
};

const topoSort = (
  edges: ReadonlyArray<FieldDependencyEdge>,
  fieldIdSet: Set<string>
): { ordered: ReadonlyArray<string>; levels: Map<string, number> } => {
  const adjacency = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  const levels = new Map<string, number>();

  for (const id of fieldIdSet) {
    indegree.set(id, 0);
    adjacency.set(id, []);
    levels.set(id, 0);
  }

  for (const edge of edges) {
    const from = edge.fromFieldId.toString();
    const to = edge.toFieldId.toString();
    if (!fieldIdSet.has(from) || !fieldIdSet.has(to)) continue;
    adjacency.get(from)!.push(to);
    indegree.set(to, (indegree.get(to) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, degree] of indegree.entries()) {
    if (degree === 0) queue.push(id);
  }

  const ordered: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    ordered.push(id);
    const nexts = adjacency.get(id) ?? [];
    for (const next of nexts) {
      indegree.set(next, (indegree.get(next) ?? 0) - 1);
      const nextLevel = Math.max(levels.get(next) ?? 0, (levels.get(id) ?? 0) + 1);
      levels.set(next, nextLevel);
      if (indegree.get(next) === 0) {
        queue.push(next);
      }
    }
  }

  return { ordered, levels };
};

const buildSteps = (
  ordered: ReadonlyArray<string>,
  levels: Map<string, number>,
  fieldsById: Map<string, FieldMeta>
): Result<ReadonlyArray<UpdateStep>, DomainError> => {
  const grouped = new Map<string, { tableId: TableId; level: number; fieldIds: FieldId[] }>();
  for (const fieldId of ordered) {
    const meta = fieldsById.get(fieldId);
    if (!meta) {
      return err(domainError.notFound({ message: `Missing field metadata for ${fieldId}` }));
    }
    const level = levels.get(fieldId) ?? 0;
    const key = `${meta.tableId.toString()}|${level}`;
    const entry = grouped.get(key) ?? {
      tableId: meta.tableId,
      level,
      fieldIds: [],
    };
    entry.fieldIds.push(meta.id);
    grouped.set(key, entry);
  }

  const steps = [...grouped.values()];
  steps.sort((a, b) =>
    a.level === b.level
      ? a.tableId.toString().localeCompare(b.tableId.toString())
      : a.level - b.level
  );

  return ok(steps);
};

const buildPropagationEdges = (
  edges: ReadonlyArray<FieldDependencyEdge>,
  fieldsById: Map<string, FieldMeta>,
  computedFieldIds: Set<string>,
  levels: Map<string, number>,
  symmetricLinkEdges: ReadonlyArray<{
    fromFieldId: FieldId;
    toFieldId: FieldId;
    fromTableId: TableId;
    toTableId: TableId;
  }>
): Result<ReadonlyArray<ComputedDependencyEdge>, DomainError> => {
  const result: ComputedDependencyEdge[] = [];

  for (const edge of edges) {
    const toId = edge.toFieldId.toString();
    if (!computedFieldIds.has(toId)) continue;

    // Only cross_record edges need dirty record propagation
    // Note: cross_record includes self-referencing links (same table, different records)
    if (edge.kind !== 'cross_record') continue;

    // For cross_record edges, linkFieldId should be present on the edge
    let linkFieldId = edge.linkFieldId;

    // Fallback: derive linkFieldId from field metadata if not on edge
    if (!linkFieldId) {
      const meta = fieldsById.get(toId);
      if (!meta) continue;

      if (meta.type === 'lookup' || meta.type === 'rollup') {
        if (!meta.lookupOptions) {
          return err(
            domainError.validation({ message: `Missing lookupOptions for field ${toId}` })
          );
        }
        const linkFieldResult = FieldId.create(meta.lookupOptions.linkFieldId);
        if (linkFieldResult.isErr()) return err(linkFieldResult.error);
        linkFieldId = linkFieldResult.value;
      } else if (meta.type === 'link') {
        linkFieldId = meta.id;
      }
    }

    if (!linkFieldId) continue;

    result.push({
      fromFieldId: edge.fromFieldId,
      toFieldId: edge.toFieldId,
      fromTableId: edge.fromTableId,
      toTableId: edge.toTableId,
      linkFieldId,
      order: levels.get(toId) ?? 0,
    });
  }

  result.sort((a, b) => a.order - b.order);

  for (const edge of symmetricLinkEdges) {
    const toId = edge.toFieldId.toString();
    const order = levels.get(toId) ?? 0;
    result.push({
      fromFieldId: edge.fromFieldId,
      toFieldId: edge.toFieldId,
      fromTableId: edge.fromTableId,
      toTableId: edge.toTableId,
      linkFieldId: edge.toFieldId,
      order,
    });
  }

  result.sort((a, b) => a.order - b.order);
  return ok(result);
};

/**
 * Build same-table batches from steps and edges.
 *
 * A batch groups consecutive steps for the same table where:
 * 1. All steps are in the same table
 * 2. Dependencies between steps are only same_record (not cross_record)
 *
 * This allows using CTE optimization to compute all fields in a single UPDATE.
 */
const buildSameTableBatches = (
  steps: ReadonlyArray<UpdateStep>,
  edges: ReadonlyArray<FieldDependencyEdge>
): ReadonlyArray<SameTableBatch> => {
  if (steps.length === 0) return [];

  // Build a map of cross_record dependencies for quick lookup
  const hasCrossRecordDependency = new Set<string>();
  for (const edge of edges) {
    if (edge.kind === 'cross_record') {
      // Mark the target field as having a cross_record dependency
      hasCrossRecordDependency.add(edge.toFieldId.toString());
    }
  }

  // Group steps by table
  const stepsByTable = new Map<string, UpdateStep[]>();
  for (const step of steps) {
    const tableId = step.tableId.toString();
    if (!stepsByTable.has(tableId)) {
      stepsByTable.set(tableId, []);
    }
    stepsByTable.get(tableId)!.push(step);
  }

  const batches: SameTableBatch[] = [];

  for (const [, tableSteps] of stepsByTable) {
    // Sort by level
    const sortedSteps = [...tableSteps].sort((a, b) => a.level - b.level);

    // Find consecutive steps that only have same_record dependencies
    let currentBatch: UpdateStep[] = [];
    let batchStartLevel = sortedSteps[0].level;

    for (const step of sortedSteps) {
      // Check if any field in this step has a cross_record dependency
      const hasCrossRecord = step.fieldIds.some((fieldId) =>
        hasCrossRecordDependency.has(fieldId.toString())
      );

      if (hasCrossRecord && currentBatch.length > 0) {
        // Current step has cross_record dependency - finalize current batch
        batches.push({
          tableId: currentBatch[0].tableId,
          steps: currentBatch,
          minLevel: batchStartLevel,
          maxLevel: currentBatch[currentBatch.length - 1].level,
        });
        currentBatch = [step];
        batchStartLevel = step.level;
      } else {
        // Add to current batch
        currentBatch.push(step);
      }
    }

    // Add final batch
    if (currentBatch.length > 0) {
      batches.push({
        tableId: currentBatch[0].tableId,
        steps: currentBatch,
        minLevel: batchStartLevel,
        maxLevel: currentBatch[currentBatch.length - 1].level,
      });
    }
  }

  // Sort batches by minLevel
  batches.sort((a, b) => a.minLevel - b.minLevel);

  return batches;
};
