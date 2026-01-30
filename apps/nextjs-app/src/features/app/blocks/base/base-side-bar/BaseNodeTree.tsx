'use client';

import { useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal } from '@teable/icons';
import type {
  IBaseNodeVo,
  IBaseNodeWorkflowResourceMeta,
  IBaseNodeAppResourceMeta,
} from '@teable/openapi';
import { BaseNodeResourceType } from '@teable/openapi';
import { LocalStorageKeys, ReactQueryKeys } from '@teable/sdk/config';
import { useBaseId, useBasePermission } from '@teable/sdk/hooks';
import {
  AssistiveTreeDescription,
  createOnDropHandler,
  dragAndDropFeature,
  hotkeysCoreFeature,
  keyboardDragAndDropFeature,
  selectionFeature,
  syncDataLoaderFeature,
  useTree,
} from '@teable/ui-lib/base/headless-tree';
import type { DragTarget, ItemInstance } from '@teable/ui-lib/base/headless-tree';
import AddBoldIcon from '@teable/ui-lib/icons/app/add-bold.svg';
import { Button, cn, Input, Skeleton } from '@teable/ui-lib/shadcn';
import { ScrollArea, ScrollBar } from '@teable/ui-lib/shadcn/ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib/shadcn/ui/tooltip';
import { Tree, TreeDragLine, TreeItem, TreeItemLabel } from '@teable/ui-lib/shadcn/ui/tree';
import { ChevronDownIcon } from 'lucide-react';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useClickAway, useLocalStorage } from 'react-use';
import { Emoji } from '@/features/app/components/emoji/Emoji';
import { EmojiPicker } from '@/features/app/components/emoji/EmojiPicker';
import { useBaseResource } from '@/features/app/hooks/useBaseResource';
import { useDisableAIAction } from '@/features/app/hooks/useDisableAIAction';
import { useIsCommunity } from '@/features/app/hooks/useIsCommunity';
import { useSetting } from '@/features/app/hooks/useSetting';
import { usePinMap } from '../../space/usePinMap';
import { useTableHref } from '../../table-list/useTableHref';
import { useGridSearchStore } from '../../view/grid/useGridSearchStore';
import {
  BaseNodeResourceIconMap,
  getNodeIcon,
  getNodeName,
  getNodeUrl,
  ROOT_ID,
  useBaseNodeCrud,
} from '../base-node/hooks';
import type { TreeItemData } from '../base-node/hooks';
import { useBaseNodeContext } from '../base-node/hooks/useBaseNodeContext';
import { BaseNodeAddResourceButton } from './BaseNodeAddResourceButton';
import { BaseNodeMore } from './BaseNodeMore';
import { BaseNodeStarButton } from './BaseNodeStarButton';

const INDENTATION_WIDTH = 24;
const SCROLL_EDGE_THRESHOLD = 60; // pixels from edge to trigger scroll
const SCROLL_MAX_SPEED = 15; // max pixels per frame

// Custom hook for auto-scroll during drag
const useDragAutoScroll = (viewportRef: React.RefObject<HTMLDivElement | null>) => {
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    let scrollSpeed = 0;

    const scroll = () => {
      if (scrollSpeed !== 0) {
        viewport.scrollTop += scrollSpeed;
        rafRef.current = requestAnimationFrame(scroll);
      } else {
        rafRef.current = null;
      }
    };

    const handleDragOver = (e: DragEvent) => {
      const rect = viewport.getBoundingClientRect();
      const y = e.clientY;
      const distanceFromTop = y - rect.top;
      const distanceFromBottom = rect.bottom - y;

      if (distanceFromTop < SCROLL_EDGE_THRESHOLD) {
        // Accelerate based on proximity to edge
        const ratio = 1 - distanceFromTop / SCROLL_EDGE_THRESHOLD;
        scrollSpeed = -Math.round(SCROLL_MAX_SPEED * ratio);
        if (!rafRef.current) rafRef.current = requestAnimationFrame(scroll);
      } else if (distanceFromBottom < SCROLL_EDGE_THRESHOLD) {
        const ratio = 1 - distanceFromBottom / SCROLL_EDGE_THRESHOLD;
        scrollSpeed = Math.round(SCROLL_MAX_SPEED * ratio);
        if (!rafRef.current) rafRef.current = requestAnimationFrame(scroll);
      } else {
        scrollSpeed = 0;
      }
    };

    const stopScroll = () => {
      scrollSpeed = 0;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };

    viewport.addEventListener('dragover', handleDragOver);
    viewport.addEventListener('dragend', stopScroll);
    viewport.addEventListener('drop', stopScroll);

    return () => {
      viewport.removeEventListener('dragover', handleDragOver);
      viewport.removeEventListener('dragend', stopScroll);
      viewport.removeEventListener('drop', stopScroll);
      stopScroll();
    };
  }, [viewportRef]);
};

type TreeMode = 'view' | 'edit';

interface IBaseNodeTreeProps {
  mode?: TreeMode;
  emptyText?: string;
  skeleton?: React.ReactNode;
  onPrimaryAction?: (item: ItemInstance<TreeItemData>) => void;
}

export const BaseNodeTree = (props: IBaseNodeTreeProps) => {
  const { mode = 'edit', emptyText, onPrimaryAction } = props;
  const isEditMode = mode === 'edit';
  const queryClient = useQueryClient();
  const { t } = useTranslation(['common']);
  const baseId = useBaseId() as string;
  const router = useRouter();
  const baseResource = useBaseResource();
  const { highlightedTableId } = useGridSearchStore();
  const { hrefMap: tableHrefMap, viewIdMap: tableViewIdsMap } = useTableHref();
  const permission = useBasePermission();
  const { buildApp: buildAppEnabled } = useDisableAIAction();
  const { disallowDashboard } = useSetting();
  const pinMap = usePinMap();
  const isCommunity = useIsCommunity();
  const canCreateTable = Boolean(permission?.['table|create']);
  const canCreateDashboard = Boolean(permission?.['base|update'] && !disallowDashboard);
  const canCreateWorkflow = !isCommunity && Boolean(permission?.['automation|create']);
  const canCreateApp = !isCommunity && Boolean(buildAppEnabled && permission?.['app|create']);
  const canCreateFolder = Boolean(permission?.['base|update']);
  const canUpdateTable = Boolean(permission?.['table|update']);

  const canCreateResource =
    isEditMode &&
    Boolean(
      canCreateTable || canCreateDashboard || canCreateWorkflow || canCreateApp || canCreateFolder
    );
  const canMoveNode = isEditMode && Boolean(permission?.['base|update']);

  const { isLoading, maxFolderDepth, treeItems, setTreeItems } = useBaseNodeContext();
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const draggedItemsRef = useRef<ItemInstance<TreeItemData>[]>([]);
  const treeItemsRef = useRef(treeItems);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [expandedItemsMap, setExpandedItemsMap] = useLocalStorage<Record<string, string[]>>(
    LocalStorageKeys.BaseNodeTreeExpandedItems,
    {}
  );
  const [expandedItems, setExpandedItems] = useState<string[]>(expandedItemsMap?.[baseId] ?? []);
  useEffect(() => {
    setExpandedItemsMap((prev) => {
      return {
        ...prev,
        [baseId]: expandedItems,
      };
    });
  }, [expandedItems, baseId, setExpandedItemsMap]);

  const handlePrimaryAction = useCallback(
    (item: ItemInstance<TreeItemData>) => {
      if (onPrimaryAction) {
        onPrimaryAction(item);
        return;
      }
      const node = item.getItemData();
      const { resourceType, resourceId } = node;
      if (resourceType === BaseNodeResourceType.Table) {
        const viewId = tableViewIdsMap[resourceId];
        const url = tableHrefMap[resourceId];
        if (url) {
          router.push({ pathname: url }, undefined, {
            shallow: Boolean(viewId),
          });
          return;
        }
      }

      const url = getNodeUrl({
        baseId,
        resourceType,
        resourceId,
      });
      if (!url) return;
      router.push(url, undefined, {
        shallow: true,
      });
    },
    [baseId, router, tableHrefMap, tableViewIdsMap, onPrimaryAction]
  );

  const handleDrop = (items: ItemInstance<TreeItemData>[], target: DragTarget<TreeItemData>) => {
    const handler = createOnDropHandler<TreeItemData>((parentItem, newChildrenIds) => {
      setTreeItems((prevItems) => ({
        ...prevItems,
        [parentItem.getId()]: {
          ...prevItems[parentItem.getId()],
          children: newChildrenIds,
        },
      }));

      if (draggedItemsRef.current.length > 0) {
        const draggedItem = draggedItemsRef.current[0];
        const draggedNodeId = draggedItem.getId();
        const newIndex = newChildrenIds.indexOf(draggedNodeId);

        if (newIndex !== -1) {
          const parentId = parentItem.getId() === ROOT_ID ? null : parentItem.getId();
          let anchorId: string | undefined;
          let position: 'before' | 'after' | undefined;

          if (newIndex > 0 && newChildrenIds[newIndex - 1]) {
            anchorId = newChildrenIds[newIndex - 1];
            position = 'after';
          } else if (newChildrenIds[newIndex + 1]) {
            anchorId = newChildrenIds[newIndex + 1];
            position = 'before';
          }
          curdHooks.moveNode(draggedNodeId, {
            parentId: anchorId ? undefined : parentId,
            anchorId,
            position,
          });
        }
      }
    });
    if (!canMoveNode) return Promise.resolve();
    draggedItemsRef.current = items;
    return handler(items, target);
  };

  const tree = useTree<TreeItemData>({
    state: {
      selectedItems,
      expandedItems,
    },
    setSelectedItems,
    setExpandedItems,
    rootItemId: ROOT_ID,
    indent: INDENTATION_WIDTH,
    dataLoader: {
      getItem: (itemId) => treeItemsRef.current[itemId] ?? {},
      getChildren: (itemId) => treeItemsRef.current[itemId]?.children ?? [],
    },
    getItemName: (item) => getNodeName(item.getItemData()),
    isItemFolder: (item) => item.getItemData().resourceType === BaseNodeResourceType.Folder,
    canReorder: true,
    canDrop: (items, target) => {
      // Basic validation
      if (editingNodeId || !canMoveNode || items.length !== 1) return false;

      const isDraggingFolder = items[0].isFolder();
      const isReordering = 'childIndex' in target;

      // === Non-folder items ===
      if (!isDraggingFolder) {
        // Reorder: ✅ allowed at any level
        if (isReordering) return true;
        // Drop into folder: ✅ | Drop into non-folder: ❌
        return target.item.isFolder();
      }

      // === Folder items ===
      if (isReordering) {
        // Reorder at level 0, 1: ✅ | Reorder at level >= 2: ❌
        return target.dragLineLevel < maxFolderDepth;
      }

      // Drop into level 0 folder: ✅ | Drop into level 1+ folder or non-folder: ❌
      return target.item.isFolder() && getItemLevel(target.item) < maxFolderDepth - 1;
    },
    onDrop: handleDrop,
    onPrimaryAction: handlePrimaryAction,
    features: [
      syncDataLoaderFeature,
      selectionFeature,
      hotkeysCoreFeature,
      dragAndDropFeature,
      keyboardDragAndDropFeature,
    ],
  });

  const createSuccefulyCallback = useCallback(
    (node: IBaseNodeVo) => {
      const { resourceType, resourceId, parentId, resourceMeta } = node;
      const viewId =
        resourceType === BaseNodeResourceType.Table ? resourceMeta?.defaultViewId : undefined;
      const parentItem = parentId ? treeItemsRef.current[parentId] : null;

      const url = getNodeUrl({
        baseId,
        resourceType,
        resourceId,
        viewId,
      });
      if (url) {
        if (resourceType === BaseNodeResourceType.Table) {
          router.push(url, undefined, { shallow: Boolean(viewId) });
        } else {
          router.push(url, undefined, { shallow: true });
        }
      }

      if (parentItem && parentItem.resourceType === BaseNodeResourceType.Folder) {
        setExpandedItems((prev) => [...(prev ?? []), parentItem.id]);
      }
      setSelectedItems([node.id]);
    },
    [baseId, router, setExpandedItems, setSelectedItems]
  );

  const updateSuccefulyCallback = useCallback(
    (node: IBaseNodeVo) => {
      const { resourceType, resourceId } = node;
      switch (resourceType) {
        case BaseNodeResourceType.Dashboard:
          queryClient.invalidateQueries({ queryKey: ReactQueryKeys.getDashboard(resourceId) });
          break;
        case BaseNodeResourceType.Workflow:
          queryClient.invalidateQueries({
            queryKey: ReactQueryKeys.workflowItem(baseId, resourceId),
          });
          break;
        case BaseNodeResourceType.App:
          queryClient.invalidateQueries({ queryKey: ReactQueryKeys.getApp(baseId, resourceId) });
          break;
      }
    },
    [baseId, queryClient]
  );

  const getAllParentIds = useCallback((nodeId: string) => {
    const parentIds: string[] = [];
    let parentId = treeItemsRef.current[nodeId]?.parentId;
    while (parentId) {
      parentIds.push(parentId);
      parentId = treeItemsRef.current[parentId]?.parentId;
    }
    return parentIds;
  }, []);

  const curdHooks = useBaseNodeCrud({
    onCreateSuccess: createSuccefulyCallback,
    onUpdateSuccess: updateSuccefulyCallback,
  });

  useEffect(() => {
    treeItemsRef.current = treeItems;
  }, [treeItems]);

  const currentResourceId = useMemo(() => {
    switch (baseResource.resourceType) {
      case BaseNodeResourceType.Table:
        return baseResource.tableId;
      case BaseNodeResourceType.Dashboard:
        return baseResource.dashboardId;
      case BaseNodeResourceType.Workflow:
        return baseResource.workflowId;
      case BaseNodeResourceType.App:
        return baseResource.appId;
      default:
        return undefined;
    }
  }, [baseResource]);

  useEffect(() => {
    if (Object.keys(treeItems).length === 0) return;
    const nodes = Object.values(treeItems);
    const { resourceType } = baseResource;
    const node = nodes.find(
      (node) => node.resourceType === resourceType && node.resourceId === currentResourceId
    );
    if (!node) {
      setSelectedItems([]);
      return;
    }

    const parentIds = getAllParentIds(node.id);
    if (parentIds.length > 0) {
      setExpandedItems((prev) => [...new Set([...(prev ?? []), ...parentIds])]);
    }
    setSelectedItems([node.id]);
  }, [
    treeItems,
    baseResource,
    currentResourceId,
    getAllParentIds,
    setExpandedItems,
    setSelectedItems,
  ]);

  useEffect(() => {
    if (selectedItems.length === 0) return;
    if (Object.keys(treeItems).length === 0) return;
    const focusItem = tree.getItemInstance(selectedItems[0]);
    if (focusItem) {
      focusItem.setFocused();
      focusItem.scrollTo({ block: 'nearest', inline: 'nearest' });
    }
  }, [selectedItems, tree, treeItems]);

  useEffect(() => {
    if (isLoading) return;
    tree.rebuildTree();
  }, [tree, treeItems, isLoading]);

  useEffect(() => {
    let timeout: NodeJS.Timeout | null = null;
    if (editingNodeId) {
      timeout = setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.select();
        }
      }, 200);
    }
    return () => {
      if (timeout) {
        clearTimeout(timeout);
      }
    };
  }, [editingNodeId]);

  useClickAway(inputRef, () => {
    const update = (editingNodeId: string) => {
      const item = tree.getItemInstance(editingNodeId);
      if (!item) return;
      const oldVal = item?.getItemName() ?? '';
      const newVal = inputRef.current?.value ?? '';
      if (oldVal === newVal) return;
      const nodeId = item.getId();
      curdHooks.updateNode(nodeId, {
        name: newVal,
      });
    };
    if (editingNodeId) {
      update(editingNodeId);
      setEditingNodeId(null);
    }
  });

  useDragAutoScroll(viewportRef);

  if (!baseId) {
    return null;
  }

  const ItemIcon = ({ item }: { item: ItemInstance<TreeItemData> }) => {
    const nodeId = item.getId();
    const data = item.getItemData();
    if (!data) return null;
    const IconComponent = BaseNodeResourceIconMap[data.resourceType];
    const { resourceType } = data;
    const icon = getNodeIcon(data);
    const isFolder = item.isFolder();
    if (isFolder) {
      return (
        <ChevronDownIcon className="size-4 text-muted-foreground group-aria-[expanded=false]:-rotate-90" />
      );
    }
    return (
      // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
      <div
        className="flex size-4 shrink-0 cursor-pointer items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {resourceType === BaseNodeResourceType.Table && (
          <EmojiPicker
            className="flex size-full items-center justify-center hover:bg-muted-foreground/60"
            onChange={(icon: string) => curdHooks.updateNode(nodeId, { icon })}
            disabled={!canUpdateTable}
          >
            {icon ? <Emoji emoji={icon} size="1rem" /> : <IconComponent className="size-full" />}
          </EmojiPicker>
        )}
        {resourceType !== BaseNodeResourceType.Table && <IconComponent className="size-full" />}
      </div>
    );
  };

  const ItemStatus = ({ item }: { item: ItemInstance<TreeItemData> }) => {
    const node = item.getItemData();
    if (!node) return null;
    const { resourceType, resourceMeta } = node;
    const isWorkflowActive =
      resourceType === BaseNodeResourceType.Workflow &&
      (resourceMeta as IBaseNodeWorkflowResourceMeta)?.isActive;
    const isAppPublished =
      resourceType === BaseNodeResourceType.App &&
      (resourceMeta as IBaseNodeAppResourceMeta)?.publicUrl;
    if (isWorkflowActive || isAppPublished) {
      return <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" />;
    }
    return null;
  };

  const renderEmpty = () => {
    if (isLoading) {
      return (
        <>
          {props.skeleton ? (
            props.skeleton
          ) : (
            <div className="flex w-full flex-col gap-2 !border-none px-2">
              <Skeleton className="h-7 w-full" />
              <Skeleton className="h-7 w-full" />
              <Skeleton className="h-7 w-full" />
              <Skeleton className="h-7 w-full" />
              <Skeleton className="h-7 w-full" />
              <Skeleton className="h-7 w-full" />
            </div>
          )}
        </>
      );
    } else if (emptyText) {
      return (
        <div className="flex min-h-16 w-full flex-col items-center justify-center gap-2 px-2 ">
          <p className="text-sm text-muted-foreground">{emptyText}</p>
        </div>
      );
    }
  };

  const renderViewTree = () => {
    return (
      <ScrollArea
        viewportRef={viewportRef}
        className="flex w-full !border-none px-2 [&>[data-radix-scroll-area-viewport]>div]:!block [&>[data-radix-scroll-area-viewport]>div]:!min-w-0"
        scrollBar="none"
      >
        <Tree indent={INDENTATION_WIDTH} tree={tree} className="py-1">
          <AssistiveTreeDescription tree={tree} />
          {tree.getItems().map((item) => {
            const nodeId = item.getId();
            const node = item.getItemData();
            if (!node || Object.keys(node).length === 0) return null;
            const { resourceType, resourceId } = node;
            const name = getNodeName(node);
            const isPinned = pinMap?.[resourceId];
            return (
              <TreeItem asChild key={nodeId} item={item}>
                <div className="h-8 w-full cursor-pointer">
                  <TreeItemLabel className={cn('size-full min-w-0 py-0')}>
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <ItemIcon item={item} />
                      <div className="flex min-w-0 grow items-center gap-1" title={name}>
                        <span className="truncate text-left">{name}</span>

                        <ItemStatus item={item} />
                        {
                          // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
                          <div
                            onClick={(e) => {
                              e.stopPropagation();
                            }}
                            className={cn('flex shrink-0 cursor-pointer items-center', {
                              'w-0 group-hover:w-auto': !isPinned,
                            })}
                          >
                            <BaseNodeStarButton
                              resourceType={resourceType}
                              resourceId={resourceId}
                            />
                          </div>
                        }
                      </div>
                    </div>
                  </TreeItemLabel>
                </div>
              </TreeItem>
            );
          })}
          <TreeDragLine />
        </Tree>
        <ScrollBar className="z-30" />
      </ScrollArea>
    );
  };

  const renderEditTree = () => {
    return (
      <ScrollArea
        viewportRef={viewportRef}
        className={cn(
          'flex w-full px-2 [&>[data-radix-scroll-area-viewport]>div]:!block [&>[data-radix-scroll-area-viewport]>div]:!min-w-0',
          {
            '!border-none': canCreateResource,
          }
        )}
        scrollBar="none"
      >
        <Tree indent={INDENTATION_WIDTH} tree={tree} className="py-1">
          <AssistiveTreeDescription tree={tree} />
          {tree.getItems().map((item) => {
            const nodeId = item.getId();
            const node = item.getItemData();
            if (!node || Object.keys(node).length === 0) return null;
            const { resourceType, resourceId } = node;
            const name = getNodeName(node);
            const isHighlighted = isEditMode && highlightedTableId === resourceId;
            const isPinned = pinMap?.[resourceId];
            return (
              <TreeItem asChild key={nodeId} item={item}>
                <div className="h-8 w-full cursor-pointer">
                  <TreeItemLabel
                    className={cn('size-full min-w-0 py-0', {
                      'bg-orange-300/40 hover:bg-orange-300/40': isHighlighted,
                    })}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      {editingNodeId === nodeId ? (
                        <Input
                          ref={inputRef}
                          type="text"
                          placeholder="name"
                          defaultValue={item.getItemName()}
                          style={{
                            boxShadow: 'none',
                          }}
                          className="round-none size-full cursor-text bg-background outline-none"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const newVal = e.currentTarget.value;
                              if (newVal && newVal !== item.getItemName()) {
                                curdHooks.updateNode(nodeId, { name: newVal });
                              }
                              setEditingNodeId(null);
                            } else if (e.key === 'Escape') {
                              setEditingNodeId(null);
                            }
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                          }}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                          }}
                        />
                      ) : (
                        <>
                          <ItemIcon item={item} />
                          <div className="flex min-w-0 grow items-center gap-1" title={name}>
                            <span
                              className="truncate text-left"
                              onDoubleClick={() => {
                                setEditingNodeId(nodeId);
                              }}
                            >
                              {name}
                            </span>

                            <ItemStatus item={item} />
                          </div>
                          {
                            // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
                            <div
                              onClick={(e) => {
                                e.stopPropagation();
                              }}
                              className={cn(
                                'flex shrink-0 cursor-pointer items-center gap-2 overflow-hidden',
                                {
                                  'w-0 group-hover:w-auto has-[[data-state=open]]:w-auto':
                                    !isPinned,
                                }
                              )}
                            >
                              <div className="opacity-0 group-hover:opacity-100 group-data-[folder=false]:hidden">
                                {canCreateResource && (
                                  <BaseNodeAddResourceButton
                                    createNode={curdHooks.createNode}
                                    parentId={nodeId === ROOT_ID ? undefined : nodeId}
                                    canCreateFolder={
                                      canCreateFolder && checkCanCreateFolder(item, maxFolderDepth)
                                    }
                                    canCreateTable={canCreateTable}
                                    canCreateDashboard={canCreateDashboard}
                                    canCreateWorkflow={canCreateWorkflow}
                                    canCreateApp={canCreateApp}
                                  >
                                    <Button variant="ghost" size="xs" className="size-4 p-0">
                                      <AddBoldIcon className="size-full" />
                                    </Button>
                                  </BaseNodeAddResourceButton>
                                )}
                              </div>
                              {
                                <BaseNodeStarButton
                                  resourceType={resourceType}
                                  resourceId={resourceId}
                                />
                              }
                              <BaseNodeMore
                                resourceType={resourceType}
                                resourceId={resourceId}
                                onRename={() => setEditingNodeId(nodeId)}
                                onCreateSuccess={createSuccefulyCallback}
                                onUpdateSuccess={updateSuccefulyCallback}
                              >
                                <Button variant="ghost" size="xs" className="size-4 p-0">
                                  <MoreHorizontal className="size-full" />
                                </Button>
                              </BaseNodeMore>
                            </div>
                          }
                        </>
                      )}
                    </div>
                  </TreeItemLabel>
                </div>
              </TreeItem>
            );
          })}
          <TreeDragLine />
        </Tree>
        <ScrollBar className="z-30" />
      </ScrollArea>
    );
  };

  return (
    <>
      {canCreateResource && (
        <div className="flex w-full flex-col px-4 pb-2 pt-4">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="w-full">
                  <BaseNodeAddResourceButton
                    createNode={curdHooks.createNode}
                    parentId={ROOT_ID}
                    canCreateFolder={canCreateFolder}
                    canCreateTable={canCreateTable}
                    canCreateDashboard={canCreateDashboard}
                    canCreateWorkflow={canCreateWorkflow}
                    canCreateApp={canCreateApp}
                  >
                    <Button
                      variant={'outline'}
                      size={'xs'}
                      className="w-full"
                      disabled={!canCreateResource}
                    >
                      <AddBoldIcon className="size-4" />
                      <span className="truncate text-left">{t('common:base.createResource')}</span>
                    </Button>
                  </BaseNodeAddResourceButton>
                </span>
              </TooltipTrigger>
              {!canCreateResource && (
                <TooltipContent>{t('common:base.noPermissionToCreateResource')}</TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
        </div>
      )}
      {Object.keys(treeItems).length === 0
        ? renderEmpty()
        : isEditMode
          ? renderEditTree()
          : renderViewTree()}
    </>
  );
};

const getItemLevel = (item: ItemInstance<TreeItemData>) => {
  const meta = item.getItemMeta();
  return meta.level;
};

const checkCanCreateFolder = (item: ItemInstance<TreeItemData>, maxFolderDepth: number) => {
  const level = getItemLevel(item);
  return level < maxFolderDepth - 1;
};
