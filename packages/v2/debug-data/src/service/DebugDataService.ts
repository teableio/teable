import { BaseId, FieldId, TableId, RecordId, domainError, type DomainError } from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import { err, ok, type Result } from 'neverthrow';

import { v2DebugDataTokens } from '../di/tokens';
import type { IDebugMetaStore } from '../ports/DebugMetaStore';
import type { IDebugRecordStore } from '../ports/DebugRecordStore';
import type {
  DebugFieldRelationGraphData,
  IDebugFieldRelationGraph,
} from '../ports/FieldRelationGraph';
import {
  type DebugFieldRelationDirection,
  type DebugFieldRelationEdge,
  type DebugFieldRelationNode,
  type DebugFieldRelationOptions,
  type DebugFieldRelationReport,
  type DebugFieldSummary,
  type DebugRawRecordQueryOptions,
} from '../types';

@injectable()
export class DebugDataService {
  constructor(
    @inject(v2DebugDataTokens.metaStore) private readonly metaStore: IDebugMetaStore,
    @inject(v2DebugDataTokens.recordStore) private readonly recordStore: IDebugRecordStore,
    @inject(v2DebugDataTokens.relationGraph)
    private readonly relationGraph: IDebugFieldRelationGraph
  ) {}

  async getTableMeta(tableId: string) {
    const parsed = TableId.create(tableId);
    if (parsed.isErr()) return err(parsed.error);
    return this.metaStore.getTableMeta(parsed.value);
  }

  async getTablesByBaseId(baseId: string) {
    const parsed = BaseId.create(baseId);
    if (parsed.isErr()) return err(parsed.error);
    return this.metaStore.getTablesByBaseId(parsed.value);
  }

  async getField(fieldId: string) {
    const parsed = FieldId.create(fieldId);
    if (parsed.isErr()) return err(parsed.error);
    return this.metaStore.getField(parsed.value);
  }

  async getFieldsByTableId(tableId: string) {
    const parsed = TableId.create(tableId);
    if (parsed.isErr()) return err(parsed.error);
    return this.metaStore.getFieldsByTableId(parsed.value);
  }

  async getRawRecords(tableId: string, options?: DebugRawRecordQueryOptions) {
    const parsed = TableId.create(tableId);
    if (parsed.isErr()) return err(parsed.error);
    return this.recordStore.getRawRecords(parsed.value, options);
  }

  async getRawRecord(tableId: string, recordId: string) {
    const parsedTableId = TableId.create(tableId);
    if (parsedTableId.isErr()) return err(parsedTableId.error);
    const parsedRecordId = RecordId.create(recordId);
    if (parsedRecordId.isErr()) return err(parsedRecordId.error);
    return this.recordStore.getRawRecord(parsedTableId.value, parsedRecordId.value);
  }

  async getFieldRelationReport(
    fieldId: string,
    options: DebugFieldRelationOptions = {}
  ): Promise<Result<DebugFieldRelationReport, DomainError>> {
    const parsedFieldId = FieldId.create(fieldId);
    if (parsedFieldId.isErr()) return err(parsedFieldId.error);

    const normalizedOptions = normalizeRelationOptions(options);
    if (normalizedOptions.isErr()) return err(normalizedOptions.error);

    const fieldResult = await this.metaStore.getField(parsedFieldId.value);
    if (fieldResult.isErr()) return err(fieldResult.error);
    if (!fieldResult.value) {
      return err(
        domainError.notFound({
          message: `Field ${fieldId} not found`,
          details: { fieldId },
        })
      );
    }
    const field = fieldResult.value;

    const parsedBaseId = BaseId.create(field.baseId);
    if (parsedBaseId.isErr()) return err(parsedBaseId.error);

    const graphResult = await this.relationGraph.load(parsedBaseId.value);
    if (graphResult.isErr()) return err(graphResult.error);

    const graph = graphResult.value;
    const startTableId = field.tableId;
    const edges = filterEdges(graph, startTableId, normalizedOptions.value.sameTableOnly);

    const traversal = buildTraversals(
      field.id,
      edges,
      normalizedOptions.value.direction,
      normalizedOptions.value.maxDepth
    );

    const nodeIds = collectNodeIds(traversal);
    const fieldIdsResult = toFieldIds(nodeIds);
    if (fieldIdsResult.isErr()) return err(fieldIdsResult.error);

    const fieldSummariesResult = await this.metaStore.getFieldSummariesByIds(fieldIdsResult.value);
    if (fieldSummariesResult.isErr()) return err(fieldSummariesResult.error);

    const parsedTableId = TableId.create(field.tableId);
    if (parsedTableId.isErr()) return err(parsedTableId.error);

    const tableSummaryResult = await this.metaStore.getTableSummary(parsedTableId.value);
    if (tableSummaryResult.isErr()) return err(tableSummaryResult.error);
    if (!tableSummaryResult.value) {
      return err(
        domainError.notFound({
          message: `Table ${field.tableId} not found`,
          details: { tableId: field.tableId },
        })
      );
    }

    const nodes = buildNodes(nodeIds, fieldSummariesResult.value, graph, traversal);

    const edgesList = mergeEdges(traversal.up.edges, traversal.down.edges);

    const report: DebugFieldRelationReport = {
      field,
      table: tableSummaryResult.value,
      baseId: field.baseId,
      options: normalizedOptions.value,
      nodes,
      edges: edgesList,
      stats: {
        nodeCount: Object.keys(nodes).length,
        edgeCount: edgesList.length,
        maxDepthUp: maxDepthOf(traversal.up.depths),
        maxDepthDown: maxDepthOf(traversal.down.depths),
      },
    };

    return ok(report);
  }
}

type TraversalState = {
  depths: Map<string, number>;
  edges: DebugFieldRelationEdge[];
};

type TraversalBundle = {
  up: TraversalState;
  down: TraversalState;
};

type NormalizedRelationOptions = {
  direction: DebugFieldRelationDirection;
  maxDepth: number | null;
  sameTableOnly: boolean;
};

const normalizeRelationOptions = (
  options: DebugFieldRelationOptions
): Result<NormalizedRelationOptions, DomainError> => {
  const direction = options.direction ?? 'both';
  if (!['up', 'down', 'both'].includes(direction)) {
    return err(
      domainError.validation({
        message: `Invalid direction: ${direction}`,
        details: { direction },
      })
    );
  }
  const maxDepth = options.maxDepth ?? null;
  if (maxDepth !== null && (!Number.isInteger(maxDepth) || maxDepth < 0)) {
    return err(
      domainError.validation({
        message: `Invalid maxDepth: ${maxDepth}`,
        details: { maxDepth },
      })
    );
  }
  const sameTableOnly = options.sameTableOnly ?? false;
  return ok({ direction, maxDepth, sameTableOnly });
};

const filterEdges = (
  graph: DebugFieldRelationGraphData,
  startTableId: string,
  sameTableOnly: boolean
): DebugFieldRelationEdge[] => {
  if (!sameTableOnly) return [...graph.edges];
  return graph.edges.filter(
    (edge) => edge.fromTableId === startTableId && edge.toTableId === startTableId
  );
};

const buildTraversals = (
  fieldId: string,
  edges: DebugFieldRelationEdge[],
  direction: DebugFieldRelationDirection,
  maxDepth: number | null
): TraversalBundle => {
  const empty: TraversalState = { depths: new Map([[fieldId, 0]]), edges: [] };
  if (direction === 'up') {
    return {
      up: traverse(fieldId, edges, 'up', maxDepth),
      down: empty,
    };
  }
  if (direction === 'down') {
    return {
      up: empty,
      down: traverse(fieldId, edges, 'down', maxDepth),
    };
  }
  return {
    up: traverse(fieldId, edges, 'up', maxDepth),
    down: traverse(fieldId, edges, 'down', maxDepth),
  };
};

const traverse = (
  startId: string,
  edges: DebugFieldRelationEdge[],
  direction: 'up' | 'down',
  maxDepth: number | null
): TraversalState => {
  const adjacency = buildAdjacency(edges, direction);
  const visited = new Map<string, number>([[startId, 0]]);
  const edgeMap = new Map<string, DebugFieldRelationEdge>();
  const queue: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    const { id, depth } = current;
    if (maxDepth !== null && depth >= maxDepth) continue;

    const nextEdges = adjacency.get(id) ?? [];
    for (const edge of nextEdges) {
      const nextId = direction === 'down' ? edge.toFieldId : edge.fromFieldId;
      const nextDepth = depth + 1;

      const existingDepth = visited.get(nextId);
      if (existingDepth === undefined || nextDepth < existingDepth) {
        visited.set(nextId, nextDepth);
        queue.push({ id: nextId, depth: nextDepth });
      }
      edgeMap.set(edgeKey(edge), edge);
    }
  }

  return { depths: visited, edges: [...edgeMap.values()] };
};

const buildAdjacency = (
  edges: DebugFieldRelationEdge[],
  direction: 'up' | 'down'
): Map<string, DebugFieldRelationEdge[]> => {
  const map = new Map<string, DebugFieldRelationEdge[]>();
  for (const edge of edges) {
    const key = direction === 'down' ? edge.fromFieldId : edge.toFieldId;
    const list = map.get(key);
    if (list) {
      list.push(edge);
    } else {
      map.set(key, [edge]);
    }
  }
  return map;
};

const collectNodeIds = (traversal: TraversalBundle): ReadonlyArray<string> => {
  const ids = new Set<string>();
  for (const id of traversal.up.depths.keys()) ids.add(id);
  for (const id of traversal.down.depths.keys()) ids.add(id);
  return [...ids];
};

const toFieldIds = (ids: ReadonlyArray<string>): Result<ReadonlyArray<FieldId>, DomainError> => {
  const fieldIds: FieldId[] = [];
  for (const id of ids) {
    const parsed = FieldId.create(id);
    if (parsed.isErr()) return err(parsed.error);
    fieldIds.push(parsed.value);
  }
  return ok(fieldIds);
};

const buildNodes = (
  nodeIds: ReadonlyArray<string>,
  summaries: ReadonlyArray<DebugFieldSummary>,
  graph: DebugFieldRelationGraphData,
  traversal: TraversalBundle
): Record<string, DebugFieldRelationNode> => {
  const summaryMap = new Map(summaries.map((summary) => [summary.id, summary]));
  const nodes: Record<string, DebugFieldRelationNode> = {};

  for (const id of nodeIds) {
    const summary = summaryMap.get(id) ?? null;
    const graphField = graph.fieldsById.get(id) ?? null;
    nodes[id] = {
      id,
      tableId: summary?.tableId ?? graphField?.tableId ?? null,
      tableName: summary?.tableName ?? null,
      name: summary?.name ?? null,
      type: summary?.type ?? graphField?.type ?? null,
      isComputed: summary?.isComputed ?? graphField?.isComputed ?? null,
      isLookup: summary?.isLookup ?? graphField?.isLookup ?? null,
      isPrimary: summary?.isPrimary ?? null,
      isPending: summary?.isPending ?? null,
      hasError: summary?.hasError ?? null,
      depthUp: traversal.up.depths.get(id) ?? null,
      depthDown: traversal.down.depths.get(id) ?? null,
    };
  }

  return nodes;
};

const edgeKey = (edge: DebugFieldRelationEdge): string =>
  [edge.fromFieldId, edge.toFieldId, edge.kind, edge.semantic ?? '', edge.linkFieldId ?? ''].join(
    '|'
  );

const mergeEdges = (
  upEdges: DebugFieldRelationEdge[],
  downEdges: DebugFieldRelationEdge[]
): DebugFieldRelationEdge[] => {
  const map = new Map<string, DebugFieldRelationEdge>();
  for (const edge of upEdges) map.set(edgeKey(edge), edge);
  for (const edge of downEdges) map.set(edgeKey(edge), edge);
  return [...map.values()];
};

const maxDepthOf = (depths: Map<string, number>): number => {
  let max = 0;
  for (const depth of depths.values()) {
    if (depth > max) max = depth;
  }
  return max;
};
