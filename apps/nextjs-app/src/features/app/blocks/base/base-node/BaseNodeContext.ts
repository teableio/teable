import { noop } from 'lodash';
import { createContext } from 'react';
import type { TreeItemData } from '@/features/app/blocks/base/base-node/hooks/use-base-node';

export const BaseNodeContext = createContext<{
  maxFolderDepth: number;
  treeItems: Record<string, TreeItemData>;
  setTreeItems: (
    updater: (prev: Record<string, TreeItemData>) => Record<string, TreeItemData>
  ) => void;
  invalidateMenu: () => void;
}>({
  maxFolderDepth: 2,
  treeItems: {},
  setTreeItems: noop,
  invalidateMenu: noop,
});
