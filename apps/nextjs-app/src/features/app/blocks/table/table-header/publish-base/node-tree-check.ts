import { BaseNodeResourceType } from '@teable/openapi';
import { ROOT_ID } from '../../../base/base-node/hooks';
import type { TreeItemData } from '../../../base/base-node/hooks';

export type NodeCheckedState = 'checked' | 'unchecked' | 'indeterminate';

const hasChildren = (treeItems: Record<string, TreeItemData>, nodeId: string) => {
  const node = treeItems[nodeId];
  return (
    node?.resourceType === BaseNodeResourceType.Folder &&
    Boolean(node.children?.some((childId) => treeItems[childId]))
  );
};

const collectDescendants = (treeItems: Record<string, TreeItemData>, nodeId: string): string[] => {
  const result: string[] = [];
  const visit = (id: string) => {
    treeItems[id]?.children?.forEach((childId) => {
      if (!treeItems[childId]) return;
      result.push(childId);
      visit(childId);
    });
  };
  visit(nodeId);
  return result;
};

// Leaves and empty folders are the units a folder's state is derived from
const collectSelectableUnits = (treeItems: Record<string, TreeItemData>, nodeId: string) =>
  collectDescendants(treeItems, nodeId).filter((id) => !hasChildren(treeItems, id));

export const getNodeCheckedState = (
  treeItems: Record<string, TreeItemData>,
  checkedItems: string[],
  nodeId: string
): NodeCheckedState => {
  if (!hasChildren(treeItems, nodeId)) {
    return checkedItems.includes(nodeId) ? 'checked' : 'unchecked';
  }
  const checkedSet = new Set(checkedItems);
  const units = collectSelectableUnits(treeItems, nodeId);
  const checkedCount = units.filter((id) => checkedSet.has(id)).length;
  if (checkedCount === 0) return 'unchecked';
  return checkedCount === units.length ? 'checked' : 'indeterminate';
};

/**
 * Keep folder ids in sync with their contents: a non-empty folder is selected iff all
 * of its descendants are selected. Publishing expands every submitted node to its whole
 * subtree (and adds ancestors back for structure), so a partially selected folder must
 * not be submitted. Ids missing from the tree are left untouched.
 */
const syncFolderIds = (
  treeItems: Record<string, TreeItemData>,
  checkedItems: string[],
  next: Set<string>
): string[] => {
  Object.keys(treeItems).forEach((id) => {
    if (id === ROOT_ID || !hasChildren(treeItems, id)) return;
    const allChecked = collectSelectableUnits(treeItems, id).every((unitId) => next.has(unitId));
    if (allChecked) {
      next.add(id);
    } else {
      next.delete(id);
    }
  });

  // keep the original order stable, append newly checked ids at the end
  const kept = checkedItems.filter((id) => next.has(id));
  const keptSet = new Set(kept);
  const added = [...next].filter((id) => !keptSet.has(id));
  return [...kept, ...added];
};

// Apply the folder rule to a selection that did not come from a toggle (e.g. saved nodes
// written by an older selector that left sub-folder ids behind)
export const normalizeCheckedItems = (
  treeItems: Record<string, TreeItemData>,
  checkedItems: string[]
): string[] => syncFolderIds(treeItems, checkedItems, new Set(checkedItems));

/** Toggle a node and all of its descendants (folders included), then sync folder ids. */
export const toggleNodeChecked = (
  treeItems: Record<string, TreeItemData>,
  checkedItems: string[],
  nodeId: string
): string[] => {
  const affected = [nodeId, ...collectDescendants(treeItems, nodeId)];
  const shouldCheck = getNodeCheckedState(treeItems, checkedItems, nodeId) !== 'checked';

  const next = new Set(checkedItems);
  affected.forEach((id) => (shouldCheck ? next.add(id) : next.delete(id)));

  return syncFolderIds(treeItems, checkedItems, next);
};
