'use client';

import type { IBaseNodeVo } from '@teable/openapi';
import { BaseNodeResourceType } from '@teable/openapi';
import type { ItemInstance } from '@teable/ui-lib/base/headless-tree';
import {
  checkboxesFeature,
  hotkeysCoreFeature,
  selectionFeature,
  syncDataLoaderFeature,
  useTree,
} from '@teable/ui-lib/base/headless-tree';
import { Button, cn, Input, Popover, PopoverContent, PopoverTrigger } from '@teable/ui-lib/shadcn';
import { ChevronDown, Search, X } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Emoji } from '@/features/app/components/emoji/Emoji';
import {
  BaseNodeResourceIconMap,
  getNodeIcon,
  getNodeName,
  ROOT_ID,
} from '../../../base/base-node/hooks';
import type { TreeItemData } from '../../../base/base-node/hooks';
import { useBaseNodeContext } from '../../../base/base-node/hooks/useBaseNodeContext';

interface INodeSelectProps {
  value?: string;
  onChange?: (nodeId: string, node: IBaseNodeVo) => void;
  placeholder?: string;
  allowedTypes?: BaseNodeResourceType[];
  className?: string;
  disabled?: boolean;
  // Checkbox
  showCheckbox?: boolean;
  checkedItems?: string[];
  onCheckedItemsChange?: (checkedItems: string[]) => void;
  // Total node count for "All Nodes" display
  totalNodeCount?: number;
}

const INDENTATION_WIDTH = 16;

export const NodeTreeSelect = (props: INodeSelectProps) => {
  const {
    value,
    onChange,
    placeholder,
    allowedTypes,
    className,
    disabled = false,
    showCheckbox = false,
    checkedItems: externalCheckedItems,
    onCheckedItemsChange,
    totalNodeCount,
  } = props;
  const { t } = useTranslation(['common']);
  const [open, setOpen] = useState(false);
  const { treeItems } = useBaseNodeContext();
  const treeItemsRef = useRef(treeItems);
  const [expandedItems, setExpandedItems] = useState<string[]>([]);
  const [internalCheckedItems, setInternalCheckedItems] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  // use external checkedItems or internal state
  const checkedItems = externalCheckedItems ?? internalCheckedItems;
  const setCheckedItems = useCallback(
    (updater: string[] | ((prev: string[]) => string[])) => {
      const newCheckedItems = typeof updater === 'function' ? updater(checkedItems) : updater;
      if (onCheckedItemsChange) {
        onCheckedItemsChange(newCheckedItems);
      } else {
        setInternalCheckedItems(newCheckedItems);
      }
    },
    [checkedItems, onCheckedItemsChange]
  );

  // filter nodes: filter by allowedTypes and search query
  const filteredTreeItems = useMemo(() => {
    const normalizedQuery = searchQuery.toLowerCase().trim();

    // filter by type
    let filtered: Record<string, TreeItemData> = treeItems;

    if (allowedTypes && allowedTypes.length > 0) {
      filtered = {};

      const filterByType = (nodeId: string): boolean => {
        const node = treeItems[nodeId];
        if (!node) return false;

        const isFolder = node.resourceType === BaseNodeResourceType.Folder;

        if (isFolder && node.children) {
          const filteredChildren = node.children.filter((childId) => filterByType(childId));
          if (filteredChildren.length > 0) {
            filtered[nodeId] = {
              ...node,
              children: filteredChildren,
            };
            return true;
          }
          return false;
        }

        if (allowedTypes.includes(node.resourceType)) {
          filtered[nodeId] = node;
          return true;
        }

        return false;
      };

      const rootNode = treeItems[ROOT_ID];
      if (rootNode?.children) {
        const filteredChildren = rootNode.children.filter((childId) => filterByType(childId));
        filtered[ROOT_ID] = {
          ...rootNode,
          children: filteredChildren,
        };
      }
    }

    // filter by search query
    if (normalizedQuery) {
      const searchFiltered: Record<string, TreeItemData> = {};
      const matchedNodes = new Set<string>();

      // find all matched nodes
      const findMatches = (nodeId: string) => {
        const node = filtered[nodeId];
        if (!node) return;

        const nodeName = getNodeName(node).toLowerCase();
        if (nodeName.includes(normalizedQuery)) {
          matchedNodes.add(nodeId);
        }

        if (node.children) {
          node.children.forEach((childId) => findMatches(childId));
        }
      };

      // collect all ancestors of matched nodes
      const collectAncestors = (nodeId: string) => {
        let currentId = nodeId;
        while (currentId && currentId !== ROOT_ID) {
          const node = filtered[currentId];
          if (node) {
            matchedNodes.add(currentId);
            currentId = node.parentId || '';
          } else {
            break;
          }
        }
      };

      // build filtered tree
      const buildFilteredTree = (nodeId: string): boolean => {
        const node = filtered[nodeId];
        if (!node) return false;

        if (node.children) {
          const filteredChildren = node.children.filter((childId) => {
            if (matchedNodes.has(childId)) {
              return buildFilteredTree(childId) || true;
            }
            return false;
          });

          if (filteredChildren.length > 0 || matchedNodes.has(nodeId)) {
            searchFiltered[nodeId] = {
              ...node,
              children: filteredChildren,
            };
            return true;
          }
          return false;
        }

        if (matchedNodes.has(nodeId)) {
          searchFiltered[nodeId] = node;
          return true;
        }

        return false;
      };

      // execute search
      const rootNode = filtered[ROOT_ID];
      if (rootNode?.children) {
        rootNode.children.forEach((childId) => findMatches(childId));
        matchedNodes.forEach((nodeId) => collectAncestors(nodeId));

        const filteredChildren = rootNode.children.filter((childId) => buildFilteredTree(childId));
        searchFiltered[ROOT_ID] = {
          ...rootNode,
          children: filteredChildren,
        };
      }

      return searchFiltered;
    }

    return filtered;
  }, [treeItems, allowedTypes, searchQuery]);

  useEffect(() => {
    treeItemsRef.current = filteredTreeItems;
  }, [filteredTreeItems]);

  // search: automatically expand all matched nodes
  useEffect(() => {
    if (searchQuery.trim()) {
      const nodesToExpand: string[] = [];
      const collectFolders = (nodeId: string) => {
        const node = filteredTreeItems[nodeId];
        if (!node) return;

        if (node.resourceType === BaseNodeResourceType.Folder && node.children) {
          nodesToExpand.push(nodeId);
          node.children.forEach((childId) => collectFolders(childId));
        }
      };

      const rootNode = filteredTreeItems[ROOT_ID];
      if (rootNode?.children) {
        rootNode.children.forEach((childId) => collectFolders(childId));
      }

      setExpandedItems(nodesToExpand);
    }
  }, [searchQuery, filteredTreeItems]);

  // handle node click
  const handlePrimaryAction = useCallback(
    (item: ItemInstance<TreeItemData>) => {
      const node = item.getItemData();
      const isFolder = node.resourceType === BaseNodeResourceType.Folder;

      // folder node: only expand/collapse
      if (isFolder) {
        return;
      }

      // non-folder node: trigger selection, but do not close popover
      onChange?.(item.getId(), node as unknown as IBaseNodeVo);
    },
    [onChange]
  );

  // initialize tree
  const features = [syncDataLoaderFeature, selectionFeature, hotkeysCoreFeature];
  if (showCheckbox) {
    features.push(checkboxesFeature);
  }

  const tree = useTree<TreeItemData>({
    state: {
      expandedItems,
      selectedItems: value ? [value] : [],
      ...(showCheckbox && { checkedItems }),
    },
    setExpandedItems,
    setSelectedItems: () => {
      // do not use default setSelectedItems, but handle with onPrimaryAction
    },
    ...(showCheckbox && { setCheckedItems }),
    rootItemId: ROOT_ID,
    indent: INDENTATION_WIDTH,
    dataLoader: {
      getItem: (itemId) => treeItemsRef.current[itemId] ?? {},
      getChildren: (itemId) => treeItemsRef.current[itemId]?.children ?? [],
    },
    getItemName: (item) => getNodeName(item.getItemData()),
    isItemFolder: (item) => item.getItemData().resourceType === BaseNodeResourceType.Folder,
    onPrimaryAction: handlePrimaryAction,
    features,
  });

  // when treeItems changes, rebuild tree
  useEffect(() => {
    if (Object.keys(filteredTreeItems).length > 0) {
      tree.rebuildTree();
    }
  }, [tree, filteredTreeItems]);

  // get selected node information
  const selectedNode = useMemo(() => {
    if (!value) return null;
    return treeItems[value];
  }, [value, treeItems]);

  // render node icon
  const renderNodeIcon = useCallback((item: ItemInstance<TreeItemData>) => {
    const node = item.getItemData();
    if (!node) return null;

    const IconComponent = BaseNodeResourceIconMap[node.resourceType];
    const icon = getNodeIcon(node);
    const isFolder = item.isFolder();

    if (isFolder) {
      return <IconComponent className="size-4 shrink-0" />;
    }

    if (node.resourceType === BaseNodeResourceType.Table && icon) {
      return <Emoji emoji={icon} size={16} className="size-4 shrink-0" />;
    }

    return <IconComponent className="size-4 shrink-0" />;
  }, []);

  // render selected nodes (for button display)
  const renderSelectedNodes = useCallback(() => {
    if (!showCheckbox || checkedItems.length === 0) {
      if (selectedNode) {
        const IconComponent = BaseNodeResourceIconMap[selectedNode.resourceType];
        const icon = getNodeIcon(selectedNode);
        return (
          <>
            {selectedNode.resourceType === BaseNodeResourceType.Table && icon ? (
              <Emoji emoji={icon} size={16} className="size-4 shrink-0" />
            ) : (
              <IconComponent className="size-5 shrink-0" />
            )}
            <span className="min-w-0 truncate">{getNodeName(selectedNode)}</span>
          </>
        );
      }
      return (
        <span className="truncate text-sm font-normal text-muted-foreground">
          {placeholder || t('common:actions.select')}
        </span>
      );
    }

    // If all nodes are selected, show "All Nodes"
    if (totalNodeCount && checkedItems.length === totalNodeCount) {
      return (
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="flex items-center rounded-md bg-surface px-2 py-1">
            <span className="text-xs font-normal">{t('common:allNodes')}</span>
          </div>
        </div>
      );
    }

    // multi-select mode: show first 2, remaining show +N
    const maxShow = 2;
    const selectedNodes = checkedItems
      .map((id) => treeItems[id])
      .filter((node) => node)
      .slice(0, maxShow);
    const remainingCount = checkedItems.length - maxShow;

    return (
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {selectedNodes.map((node) => {
          const IconComponent = BaseNodeResourceIconMap[node.resourceType];
          const icon = getNodeIcon(node);
          return (
            <div
              key={node.id}
              className="flex min-w-0 items-center gap-1.5 rounded-md bg-surface px-2 py-1"
            >
              {node.resourceType === BaseNodeResourceType.Table && icon ? (
                <Emoji emoji={icon} size={16} className="size-4 shrink-0" />
              ) : (
                <IconComponent className="size-4 shrink-0" />
              )}
              <span className="min-w-0 truncate text-xs">{getNodeName(node)}</span>
            </div>
          );
        })}
        {remainingCount > 0 && (
          <div className="flex items-center rounded-md bg-transparent py-1">
            <span className="text-sm">+{remainingCount}</span>
          </div>
        )}
      </div>
    );
  }, [showCheckbox, checkedItems, selectedNode, treeItems, placeholder, t, totalNodeCount]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn('h-9 w-full justify-between p-2', className)}
          disabled={disabled}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">{renderSelectedNodes()}</div>
          <ChevronDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[354px] overflow-hidden p-0" align="start">
        {/* search input */}
        <div className="px-4 pt-4">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={t('common:actions.search')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 px-8"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        </div>

        <div className="max-h-[240px] w-full overflow-x-hidden px-4 py-2">
          <div
            {...tree.getContainerProps()}
            className="flex w-full flex-col p-1"
            onWheelCapture={(e) => {
              e.stopPropagation();
            }}
          >
            {tree.getItems().length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                {t('common:noResult')}
              </div>
            ) : (
              tree.getItems().map((item) => {
                const node = item.getItemData();
                if (!node || Object.keys(node).length === 0) return null;

                const isFolder = item.isFolder();
                const isExpanded = item.isExpanded();
                const isSelected = item.isSelected();

                return (
                  <div key={item.getId()} className="flex w-full min-w-0 items-center gap-0.5">
                    {showCheckbox && (
                      <input
                        type="checkbox"
                        {...(item.getCheckboxProps ? item.getCheckboxProps() : {})}
                        className="size-4 shrink-0 cursor-pointer rounded border-gray-300 accent-black"
                        onClick={(e) => e.stopPropagation()}
                      />
                    )}
                    <button
                      {...item.getProps()}
                      type="button"
                      className={cn(
                        'flex min-w-0 flex-1 items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent',
                        isSelected && 'bg-accent',
                        'cursor-pointer'
                      )}
                      style={{
                        paddingLeft: `${item.getItemMeta().level * INDENTATION_WIDTH + 8}px`,
                      }}
                    >
                      {isFolder && (
                        <ChevronDown
                          className={cn(
                            'size-4 shrink-0 transition-transform',
                            !isExpanded && '-rotate-90'
                          )}
                        />
                      )}

                      {renderNodeIcon(item)}

                      <div className="min-w-0 flex-1 truncate text-left" title={item.getItemName()}>
                        {item.getItemName()}
                      </div>
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};
