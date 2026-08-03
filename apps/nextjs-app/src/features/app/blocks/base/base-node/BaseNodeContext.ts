import { noop } from 'lodash';
import { createContext } from 'react';
import type { TreeItemData } from './hooks';

export const BaseNodeContext = createContext<{
  isLoading: boolean;
  maxFolderDepth: number;
  treeItems: Record<string, TreeItemData>;
  setTreeItems: (
    updater: (prev: Record<string, TreeItemData>) => Record<string, TreeItemData>
  ) => void;
  invalidateMenu: () => void;
}>({
  isLoading: false,
  maxFolderDepth: 2,
  treeItems: {},
  setTreeItems: noop,
  invalidateMenu: noop,
});
