import { useMemo } from 'react';
import { create } from 'zustand';
import type { TreeItemData } from './useBaseNode';

interface ILocatedNodesState {
  /** What is pointed at, each by its node id or by the id of what the node holds. */
  ids: ReadonlySet<string>;
  locate: (ids: readonly string[]) => void;
}

const NONE: ReadonlySet<string> = new Set();

/**
 * Nodes something else on the page points at for a moment (a hovered row of a card that
 * lists what sits where). The project tree marks them while it does.
 */
export const useLocatedNodesStore = create<ILocatedNodesState>((set) => ({
  ids: NONE,
  locate: (ids) => set({ ids: ids.length ? new Set(ids) : NONE }),
}));

/**
 * Whether a row of the tree is marked: the node pointed at, or a folded folder that holds
 * it, so what is pointed at always has a row to show on.
 */
export const useLocatedTreeNodes = (treeItems: Record<string, TreeItemData>) => {
  const ids = useLocatedNodesStore((state) => state.ids);
  return useMemo(() => {
    const nodes = new Set<string>();
    const above = new Set<string>();
    if (ids.size) {
      for (const node of Object.values(treeItems)) {
        if (!ids.has(node.id) && !ids.has(node.resourceId)) continue;
        nodes.add(node.id);
        let parentId = node.parentId;
        while (parentId && !above.has(parentId)) {
          above.add(parentId);
          parentId = treeItems[parentId]?.parentId ?? null;
        }
      }
    }
    return (nodeId: string, expanded: boolean) =>
      nodes.has(nodeId) || (!expanded && above.has(nodeId));
  }, [ids, treeItems]);
};
