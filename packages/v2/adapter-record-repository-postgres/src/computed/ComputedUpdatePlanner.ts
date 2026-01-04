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
};

export type UpdateStep = {
  tableId: TableId;
  fieldIds: ReadonlyArray<FieldId>;
  level: number;
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
  extraSeedRecords: ReadonlyArray<{
    tableId: TableId;
    recordIds: ReadonlyArray<RecordId>;
  }>;
  steps: ReadonlyArray<UpdateStep>;
  edges: ReadonlyArray<ComputedDependencyEdge>;
  estimatedComplexity: number;
  changeType: UpdateContext['changeType'];
};

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
    return safeTry<ComputedUpdatePlan, DomainError>(
      async function* (this: ComputedUpdatePlanner) {
        const graphData = yield* await this.graph.load(context.table.baseId());
        const { fieldsById, edges } = graphData;

        const changedFieldIds = context.changedFieldIds;
        const affectedFieldIds = collectAffectedFieldIds(edges, changedFieldIds);
        const computedFieldIds = filterComputedFields(fieldsById, affectedFieldIds);

        // Link fields need to be refreshed when their own value changes.
        const symmetricLinkEdges: Array<{
          fromFieldId: FieldId;
          toFieldId: FieldId;
          fromTableId: TableId;
          toTableId: TableId;
        }> = [];

        for (const fieldId of changedFieldIds) {
          const meta = fieldsById.get(fieldId.toString());
          if (!meta || meta.type !== 'link') continue;

          computedFieldIds.add(fieldId.toString());

          const symmetricFieldId = meta.options?.symmetricFieldId;
          const foreignTableId = meta.options?.foreignTableId;
          if (!symmetricFieldId || !foreignTableId) continue;

          const symmetricFieldResult = FieldId.create(symmetricFieldId);
          if (symmetricFieldResult.isErr()) return err(symmetricFieldResult.error);
          const foreignTableResult = TableId.create(foreignTableId);
          if (foreignTableResult.isErr()) return err(foreignTableResult.error);

          const symmetricKey = symmetricFieldResult.value.toString();
          if (!fieldsById.has(symmetricKey)) continue;
          computedFieldIds.add(symmetricKey);
          symmetricLinkEdges.push({
            fromFieldId: meta.id,
            toFieldId: symmetricFieldResult.value,
            fromTableId: meta.tableId,
            toTableId: foreignTableResult.value,
          });
        }

        if (computedFieldIds.size === 0) {
          return ok({
            baseId: context.table.baseId(),
            seedTableId: context.table.id(),
            seedRecordIds: context.changedRecordIds,
            extraSeedRecords: [],
            steps: [],
            edges: [],
            estimatedComplexity: 0,
            changeType: context.changeType,
          });
        }

        const { ordered, levels } = topoSort(edges, computedFieldIds);
        if (ordered.length !== computedFieldIds.size) {
          return err(
            domainError.conflict({
              message: 'Computed field dependency cycle detected',
            })
          );
        }

        const steps = yield* buildSteps(ordered, levels, fieldsById);
        const propagationEdges = yield* buildPropagationEdges(
          edges,
          fieldsById,
          computedFieldIds,
          levels,
          symmetricLinkEdges
        );

        const estimatedComplexity =
          steps.length + propagationEdges.length + context.changedRecordIds.length;

        return ok({
          baseId: context.table.baseId(),
          seedTableId: context.table.id(),
          seedRecordIds: context.changedRecordIds,
          extraSeedRecords: [],
          steps,
          edges: propagationEdges,
          estimatedComplexity,
          changeType: context.changeType,
        });
      }.bind(this)
    );
  }
}

const collectAffectedFieldIds = (
  edges: ReadonlyArray<FieldDependencyEdge>,
  changedFieldIds: ReadonlyArray<FieldId>
): Set<string> => {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const from = edge.fromFieldId.toString();
    const to = edge.toFieldId.toString();
    const list = adjacency.get(from) ?? [];
    list.push(to);
    adjacency.set(from, list);
  }

  const visited = new Set<string>();
  const queue: string[] = [];
  for (const fieldId of changedFieldIds) {
    const key = fieldId.toString();
    visited.add(key);
    queue.push(key);
  }

  const affected = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    const nextList = adjacency.get(current) ?? [];
    for (const next of nextList) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
      affected.add(next);
    }
  }

  return affected;
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
    if (edge.fromTableId.equals(edge.toTableId)) continue;

    const meta = fieldsById.get(toId);
    if (!meta) continue;

    let linkFieldId: FieldId | undefined;
    if (meta.type === 'lookup' || meta.type === 'rollup') {
      if (!meta.lookupOptions) {
        return err(domainError.validation({ message: `Missing lookupOptions for field ${toId}` }));
      }
      const linkFieldResult = FieldId.create(meta.lookupOptions.linkFieldId);
      if (linkFieldResult.isErr()) return err(linkFieldResult.error);
      linkFieldId = linkFieldResult.value;
    } else if (meta.type === 'link') {
      linkFieldId = meta.id;
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
