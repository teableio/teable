import { uniq } from 'lodash';

// topo item is for field level reference, all id stands for fieldId;
export interface ITopoItem {
  id: string;
  dependencies: string[];
}

export interface IGraphItem {
  fromFieldId: string;
  toFieldId: string;
}

export type IAdjacencyMap = Record<string, string[]>;

export function buildAdjacencyMap(graph: IGraphItem[]): IAdjacencyMap {
  const adjList: IAdjacencyMap = {};
  graph.forEach((edge) => {
    if (!adjList[edge.fromFieldId]) {
      adjList[edge.fromFieldId] = [];
    }
    adjList[edge.fromFieldId].push(edge.toFieldId);
  });
  return adjList;
}

export function findNextValidNode(
  current: string,
  adjMap: IAdjacencyMap,
  linkIdSet: Set<string>
): string | null {
  if (linkIdSet.has(current)) {
    return current;
  }

  const neighbors = adjMap[current];
  if (!neighbors) {
    return null;
  }

  for (const neighbor of neighbors) {
    const validNode = findNextValidNode(neighbor, adjMap, linkIdSet);
    if (validNode) {
      return validNode;
    }
  }

  return null;
}

/**
 * Builds a compressed adjacency map based on the provided graph, linkIdSet, and startFieldIds.
 * The compressed adjacency map represents the neighbors of each node in the graph, excluding nodes that are not valid according to the linkIdSet.
 *
 * @param graph - The graph containing the nodes and their connections.
 * @param linkIdSet - A set of valid link IDs.
 * @returns The compressed adjacency map representing the neighbors of each node.
 */
export function buildCompressedAdjacencyMap(
  graph: IGraphItem[],
  linkIdSet: Set<string>
): IAdjacencyMap {
  const adjMap = buildAdjacencyMap(graph);
  const compressedAdjMap: IAdjacencyMap = {};

  // eslint-disable-next-line sonarjs/cognitive-complexity
  Object.keys(adjMap).forEach((from) => {
    const queue = [from];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || visited.has(current)) continue;

      visited.add(current);
      const neighbors = adjMap[current] || [];
      const compressedNeighbors = [];

      for (const neighbor of neighbors) {
        const nextValid = findNextValidNode(neighbor, adjMap, linkIdSet);
        if (nextValid && !visited.has(nextValid)) {
          compressedNeighbors.push(nextValid);
          if (!linkIdSet.has(current)) {
            queue.push(nextValid);
          }
        }
      }

      if (compressedNeighbors.length > 0) {
        compressedAdjMap[current] = compressedNeighbors;
      }
    }
  });

  return compressedAdjMap;
}

// eslint-disable-next-line sonarjs/cognitive-complexity
export function hasCycle(graphItems: IGraphItem[]): boolean {
  const adjList: Record<string, string[]> = {};
  const visiting = new Set<string>();
  const visited = new Set<string>();

  // Build adjacency list
  graphItems.forEach((item) => {
    if (!adjList[item.fromFieldId]) {
      adjList[item.fromFieldId] = [];
    }
    adjList[item.fromFieldId].push(item.toFieldId);
  });

  function dfs(node: string): boolean {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;

    visiting.add(node);

    if (adjList[node]) {
      for (const neighbor of adjList[node]) {
        if (dfs(neighbor)) return true;
      }
    }

    visiting.delete(node);
    visited.add(node);

    return false;
  }

  // Check for cycles
  for (const node of Object.keys(adjList)) {
    if (!visited.has(node) && dfs(node)) {
      return true;
    }
  }

  return false;
}

/**
 * Generate a topological order based on the starting node ID.
 *
 * @param startNodeId - The ID to start the search from.
 * @param graph - The input graph.
 * @returns An array of ITopoItem representing the topological order.
 */
// eslint-disable-next-line sonarjs/cognitive-complexity
export function topoOrderWithDepends(startNodeId: string, graph: IGraphItem[]): ITopoItem[] {
  const visitedNodes = new Set<string>();
  const visitingNodes = new Set<string>();
  const sortedNodes: ITopoItem[] = [];

  // Build adjacency list and reverse adjacency list
  const adjList: Record<string, string[]> = {};
  const reverseAdjList: Record<string, string[]> = {};
  for (const edge of graph) {
    if (!adjList[edge.fromFieldId]) adjList[edge.fromFieldId] = [];
    adjList[edge.fromFieldId].push(edge.toFieldId);

    if (!reverseAdjList[edge.toFieldId]) reverseAdjList[edge.toFieldId] = [];
    reverseAdjList[edge.toFieldId].push(edge.fromFieldId);
  }

  function visit(node: string) {
    if (visitingNodes.has(node)) {
      throw new Error(`Detected a cycle: ${node} is part of a circular dependency`);
    }

    if (!visitedNodes.has(node)) {
      visitingNodes.add(node);

      // Get incoming edges (dependencies)
      const dependencies = reverseAdjList[node] || [];

      // Process outgoing edges
      if (adjList[node]) {
        for (const neighbor of adjList[node]) {
          visit(neighbor);
        }
      }

      visitingNodes.delete(node);
      visitedNodes.add(node);
      sortedNodes.push({ id: node, dependencies: dependencies });
    }
  }

  visit(startNodeId);
  return sortedNodes.reverse().map((node) => ({
    id: node.id,
    dependencies: uniq(node.dependencies),
  }));
}

/**
 * Generate a topological order with based on the starting node ID.
 */
export function topoOrderWithStart(startNodeId: string, graph: IGraphItem[]): string[] {
  const visitedNodes = new Set<string>();
  const sortedNodes: string[] = [];

  // Build adjacency list and reverse adjacency list
  const adjList: Record<string, string[]> = {};
  const reverseAdjList: Record<string, string[]> = {};
  for (const edge of graph) {
    if (!adjList[edge.fromFieldId]) adjList[edge.fromFieldId] = [];
    adjList[edge.fromFieldId].push(edge.toFieldId);

    if (!reverseAdjList[edge.toFieldId]) reverseAdjList[edge.toFieldId] = [];
    reverseAdjList[edge.toFieldId].push(edge.fromFieldId);
  }

  function visit(node: string) {
    if (!visitedNodes.has(node)) {
      visitedNodes.add(node);

      // Process outgoing edges
      if (adjList[node]) {
        for (const neighbor of adjList[node]) {
          visit(neighbor);
        }
      }

      sortedNodes.push(node);
    }
  }

  visit(startNodeId);
  return sortedNodes.reverse();
}

// simple topological sort
export function topologicalSort(graph: IGraphItem[]): string[] {
  const adjList: Record<string, string[]> = {};
  const visited = new Set<string>();
  const currentStack = new Set<string>();
  const result: string[] = [];

  graph.forEach((node) => {
    if (!adjList[node.fromFieldId]) {
      adjList[node.fromFieldId] = [];
    }
    adjList[node.fromFieldId].push(node.toFieldId);
  });

  function dfs(node: string) {
    if (currentStack.has(node)) {
      throw new Error(`Detected a cycle involving node '${node}'`);
    }

    if (visited.has(node)) {
      return;
    }

    currentStack.add(node);
    visited.add(node);

    const neighbors = adjList[node] || [];
    neighbors.forEach((neighbor) => dfs(neighbor));

    currentStack.delete(node);
    result.push(node);
  }

  graph.forEach((node) => {
    if (!visited.has(node.fromFieldId)) {
      dfs(node.fromFieldId);
    }
    if (!visited.has(node.toFieldId)) {
      dfs(node.toFieldId);
    }
  });

  return result.reverse();
}

/**
 * Returns all relations related to the given fieldIds.
 */
// eslint-disable-next-line sonarjs/cognitive-complexity
export function filterDirectedGraph(
  undirectedGraph: IGraphItem[],
  fieldIds: string[]
): IGraphItem[] {
  const result: IGraphItem[] = [];
  const visited: Set<string> = new Set();
  const addedEdges: Set<string> = new Set(); // 新增：用于存储已添加的边

  // Build adjacency lists for quick look-up
  const outgoingAdjList: Record<string, IGraphItem[]> = {};
  const incomingAdjList: Record<string, IGraphItem[]> = {};

  function addEdgeIfNotExists(edge: IGraphItem) {
    const edgeKey = edge.fromFieldId + '-' + edge.toFieldId;
    if (!addedEdges.has(edgeKey)) {
      addedEdges.add(edgeKey);
      result.push(edge);
    }
  }

  for (const item of undirectedGraph) {
    // Outgoing edges
    if (!outgoingAdjList[item.fromFieldId]) {
      outgoingAdjList[item.fromFieldId] = [];
    }
    outgoingAdjList[item.fromFieldId].push(item);

    // Incoming edges
    if (!incomingAdjList[item.toFieldId]) {
      incomingAdjList[item.toFieldId] = [];
    }
    incomingAdjList[item.toFieldId].push(item);
  }

  function dfs(currentNode: string) {
    visited.add(currentNode);

    // Add incoming edges related to currentNode
    if (incomingAdjList[currentNode]) {
      incomingAdjList[currentNode].forEach((edge) => addEdgeIfNotExists(edge));
    }

    // Process outgoing edges from currentNode
    if (outgoingAdjList[currentNode]) {
      outgoingAdjList[currentNode].forEach((item) => {
        if (!visited.has(item.toFieldId)) {
          addEdgeIfNotExists(item);
          dfs(item.toFieldId);
        }
      });
    }
  }

  // Run DFS for each specified fieldId
  for (const fieldId of fieldIds) {
    if (!visited.has(fieldId)) {
      dfs(fieldId);
    }
  }

  return result;
}
