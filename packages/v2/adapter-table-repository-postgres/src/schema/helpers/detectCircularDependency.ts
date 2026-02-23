import { domainError, type DomainError, type FieldId } from '@teable/v2-core';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { FieldDependencyEdge } from '../../record/computed/FieldDependencyGraph';

/**
 * Detects circular dependencies in a field dependency graph using topological sorting.
 *
 * @param edges - The field dependency edges to check
 * @returns Ok(void) if no cycle detected, Err(DomainError) if cycle found
 *
 * @example
 * ```typescript
 * const graph = await fieldDependencyGraph.load(baseId, context);
 * const result = detectCircularDependency(graph.edges);
 * if (result.isErr()) {
 *   // Cycle detected, result.error contains cycle information
 * }
 * ```
 */
export function detectCircularDependency(
  edges: ReadonlyArray<FieldDependencyEdge>
): Result<void, DomainError> {
  if (edges.length === 0) {
    return ok(undefined);
  }

  // Build adjacency list and in-degree map
  const adjacencyList = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();
  const allFieldIds = new Set<string>();

  // Initialize nodes
  for (const edge of edges) {
    const fromId = edge.fromFieldId.toString();
    const toId = edge.toFieldId.toString();

    allFieldIds.add(fromId);
    allFieldIds.add(toId);

    if (!adjacencyList.has(fromId)) {
      adjacencyList.set(fromId, new Set());
    }
    if (!adjacencyList.has(toId)) {
      adjacencyList.set(toId, new Set());
    }

    // Check if edge already exists to avoid double-counting in-degree
    const neighbors = adjacencyList.get(fromId)!;
    const edgeExists = neighbors.has(toId);

    // Add edge: from -> to (toField depends on fromField)
    neighbors.add(toId);

    // Only increment in-degree if this is a new edge
    if (!edgeExists) {
      inDegree.set(toId, (inDegree.get(toId) ?? 0) + 1);
    }
  }

  // Initialize in-degree for nodes with no incoming edges
  for (const fieldId of allFieldIds) {
    if (!inDegree.has(fieldId)) {
      inDegree.set(fieldId, 0);
    }
  }

  // Kahn's algorithm for topological sorting
  const queue: string[] = [];
  const sorted: string[] = [];

  // Start with nodes that have no incoming edges
  for (const [fieldId, degree] of inDegree.entries()) {
    if (degree === 0) {
      queue.push(fieldId);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);

    const neighbors = adjacencyList.get(current);
    if (neighbors) {
      for (const neighbor of neighbors) {
        const newDegree = (inDegree.get(neighbor) ?? 0) - 1;
        inDegree.set(neighbor, newDegree);

        if (newDegree === 0) {
          queue.push(neighbor);
        }
      }
    }
  }

  // If not all nodes are in sorted order, there's a cycle
  if (sorted.length !== allFieldIds.size) {
    // Find nodes that are part of cycles (those with non-zero in-degree)
    const cycleNodes = [...inDegree.entries()]
      .filter(([_, degree]) => degree > 0)
      .map(([fieldId]) => fieldId);

    // Try to find an actual cycle path for better error message
    const cyclePath = findCyclePath(cycleNodes, adjacencyList);

    return err(
      domainError.validation({
        message: `Circular dependency detected in fields${cyclePath ? `: ${cyclePath}` : ` (${cycleNodes.length} fields involved)`}`,
      })
    );
  }

  return ok(undefined);
}

/**
 * Attempts to find a cycle path starting from nodes that are part of cycles.
 * Uses DFS to find a path that loops back to itself.
 */
function findCyclePath(
  cycleNodes: string[],
  adjacencyList: Map<string, Set<string>>
): string | null {
  if (cycleNodes.length === 0) return null;

  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const path: string[] = [];

  const dfs = (node: string): boolean => {
    visited.add(node);
    recursionStack.add(node);
    path.push(node);

    const neighbors = adjacencyList.get(node);
    if (neighbors) {
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          if (dfs(neighbor)) {
            return true;
          }
        } else if (recursionStack.has(neighbor)) {
          // Found a cycle - add the neighbor to complete the cycle
          path.push(neighbor);
          return true;
        }
      }
    }

    path.pop();
    recursionStack.delete(node);
    return false;
  };

  // Try to find a cycle starting from one of the cycle nodes
  for (const startNode of cycleNodes) {
    if (!visited.has(startNode)) {
      if (dfs(startNode)) {
        // Format the cycle path nicely
        return path.join(' → ');
      }
    }
  }

  return null;
}
