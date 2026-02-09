export type TopologicalSortNode<TId extends { toString(): string }> = {
  id: TId;
  dependencies: ReadonlyArray<TId>;
};

export type TopologicalSortResult<TId extends { toString(): string }> = {
  order: ReadonlyArray<TId>;
  cycles: ReadonlyArray<ReadonlyArray<TId>>;
};

export const topologicalSort = <TId extends { toString(): string }>(
  nodes: ReadonlyArray<TopologicalSortNode<TId>>
): TopologicalSortResult<TId> => {
  const idToIndex = new Map<string, number>();
  const idToNode = new Map<string, TopologicalSortNode<TId>>();
  const depsByNode = new Map<string, ReadonlyArray<string>>();

  nodes.forEach((node, index) => {
    const id = node.id.toString();
    idToIndex.set(id, index);
    idToNode.set(id, node);
    depsByNode.set(
      id,
      node.dependencies.map((dep) => dep.toString())
    );
  });

  const adjacency = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();

  for (const node of nodes) {
    inDegree.set(node.id.toString(), 0);
  }

  const addEdge = (fromId: string, toId: string) => {
    if (!idToNode.has(fromId) || !idToNode.has(toId)) return;
    const set = adjacency.get(fromId) ?? new Set<string>();
    if (!set.has(toId)) {
      set.add(toId);
      adjacency.set(fromId, set);
      inDegree.set(toId, (inDegree.get(toId) ?? 0) + 1);
    }
  };

  for (const node of nodes) {
    const nodeId = node.id.toString();
    const deps = depsByNode.get(nodeId) ?? [];
    for (const depId of deps) {
      addEdge(depId, nodeId);
    }
  }

  const zeroQueue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) zeroQueue.push(id);
  }
  zeroQueue.sort((a, b) => (idToIndex.get(a) ?? 0) - (idToIndex.get(b) ?? 0));

  const orderedIds: string[] = [];
  while (zeroQueue.length > 0) {
    const id = zeroQueue.shift()!;
    orderedIds.push(id);
    const neighbors = adjacency.get(id);
    if (!neighbors) continue;
    const orderedNeighbors = Array.from(neighbors).sort(
      (a, b) => (idToIndex.get(a) ?? 0) - (idToIndex.get(b) ?? 0)
    );
    for (const neighbor of orderedNeighbors) {
      const nextDegree = (inDegree.get(neighbor) ?? 0) - 1;
      inDegree.set(neighbor, nextDegree);
      if (nextDegree === 0) {
        const insertIndex = zeroQueue.findIndex(
          (candidate) => (idToIndex.get(candidate) ?? 0) > (idToIndex.get(neighbor) ?? 0)
        );
        if (insertIndex === -1) zeroQueue.push(neighbor);
        else zeroQueue.splice(insertIndex, 0, neighbor);
      }
    }
  }

  const remainingIds = nodes
    .map((node) => node.id.toString())
    .filter((id) => !orderedIds.includes(id));

  const cycles = detectCycles(remainingIds, depsByNode).map((cycle) =>
    cycle.map((id) => idToNode.get(id)!.id)
  );

  const orderedWithRemainder = [
    ...orderedIds,
    ...remainingIds.sort((a, b) => (idToIndex.get(a) ?? 0) - (idToIndex.get(b) ?? 0)),
  ];

  return {
    order: orderedWithRemainder.map((id) => idToNode.get(id)!.id),
    cycles,
  };
};

const detectCycles = (
  remainingIds: ReadonlyArray<string>,
  depsByNode: ReadonlyMap<string, ReadonlyArray<string>>
): ReadonlyArray<ReadonlyArray<string>> => {
  const remainingSet = new Set(remainingIds);
  const visited = new Set<string>();
  const stack = new Set<string>();
  const path: string[] = [];
  const indexById = new Map<string, number>();
  const cycles: string[][] = [];
  const cycleKeys = new Set<string>();

  const recordCycle = (cycle: string[]) => {
    const key = cycle.join('>');
    if (cycleKeys.has(key)) return;
    cycleKeys.add(key);
    cycles.push(cycle);
  };

  const dfs = (id: string) => {
    visited.add(id);
    stack.add(id);
    indexById.set(id, path.length);
    path.push(id);

    const deps = depsByNode.get(id) ?? [];
    for (const depId of deps) {
      if (!remainingSet.has(depId)) continue;
      if (!visited.has(depId)) {
        dfs(depId);
        continue;
      }
      if (stack.has(depId)) {
        const startIndex = indexById.get(depId) ?? 0;
        recordCycle(path.slice(startIndex));
      }
    }

    stack.delete(id);
    indexById.delete(id);
    path.pop();
  };

  for (const id of remainingIds) {
    if (visited.has(id)) continue;
    dfs(id);
  }

  return cycles;
};
