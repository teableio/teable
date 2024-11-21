// topo item is for field level reference, all id stands for fieldId;
export interface ITopoItem {
  id: string;
  dependencies: string[];
}

export interface IGraphItem {
  fromFieldId: string;
  toFieldId: string;
}

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

export function prependStartFieldIds(topoOrders: ITopoItem[], startFieldIds: string[]) {
  const existFieldIds = new Set(topoOrders.map((item) => item.id));
  const newTopoOrders = startFieldIds
    .filter((fieldId) => !existFieldIds.has(fieldId))
    .map((fieldId) => ({ id: fieldId, dependencies: [] }));
  return [...newTopoOrders, ...topoOrders];
}

export function getTopoOrders(graph: IGraphItem[]): ITopoItem[] {
  const visitedNodes = new Set<string>();
  const visitingNodes = new Set<string>();
  const sortedNodes: ITopoItem[] = [];
  const allNodes = new Set<string>();

  // Build adjacency list and reverse adjacency list
  const adjList: Record<string, string[]> = {};
  const reverseAdjList: Record<string, string[]> = {};
  for (const edge of graph) {
    if (!adjList[edge.fromFieldId]) adjList[edge.fromFieldId] = [];
    adjList[edge.fromFieldId].push(edge.toFieldId);

    if (!reverseAdjList[edge.toFieldId]) reverseAdjList[edge.toFieldId] = [];
    reverseAdjList[edge.toFieldId].push(edge.fromFieldId);

    // Collect all nodes
    allNodes.add(edge.fromFieldId);
    allNodes.add(edge.toFieldId);
  }

  function visit(node: string) {
    if (visitingNodes.has(node)) {
      throw new Error(`Detected a cycle: ${node} is part of a circular dependency`);
    }

    if (!visitedNodes.has(node)) {
      visitingNodes.add(node);

      // Get incoming edges (dependencies)
      const dependencies = reverseAdjList[node] || [];

      // Process dependencies first
      for (const dep of dependencies) {
        if (!visitedNodes.has(dep)) {
          visit(dep);
        }
      }

      visitingNodes.delete(node);
      visitedNodes.add(node);
      sortedNodes.push({ id: node, dependencies: dependencies });
    }
  }

  // Start with nodes that have no outgoing edges (leaf nodes)
  const startNodes = Array.from(allNodes).filter(
    (node) => !adjList[node] || adjList[node].length === 0
  );
  for (const node of startNodes) {
    if (!visitedNodes.has(node)) {
      visit(node);
    }
  }

  // Process remaining nodes
  for (const node of allNodes) {
    if (!visitedNodes.has(node)) {
      visit(node);
    }
  }

  return sortedNodes;
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

/**
 * Returns all relations related to the given fieldIds.
 */
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

export function pruneGraph(node: string, graph: IGraphItem[]): IGraphItem[] {
  const relatedNodes = new Set<string>();
  const prunedGraph: IGraphItem[] = [];

  function dfs(currentNode: string) {
    relatedNodes.add(currentNode);
    for (const edge of graph) {
      if (edge.fromFieldId === currentNode && !relatedNodes.has(edge.toFieldId)) {
        dfs(edge.toFieldId);
      }
    }
  }

  dfs(node);

  for (const edge of graph) {
    if (relatedNodes.has(edge.fromFieldId) || relatedNodes.has(edge.toFieldId)) {
      prunedGraph.push(edge);
      if (!relatedNodes.has(edge.fromFieldId)) {
        dfs(edge.fromFieldId);
      }
      if (!relatedNodes.has(edge.toFieldId)) {
        dfs(edge.toFieldId);
      }
    }
  }

  return prunedGraph;
}
