'use client';

import { BaseNodeResourceType } from '@teable/openapi';
import { LocalStorageKeys } from '@teable/sdk/config';
import { useBaseId, useBasePermission } from '@teable/sdk/hooks';
import { useConfirm } from '@teable/ui-lib/base/dialog/confirm-modal';
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
import { Button, Input } from '@teable/ui-lib/shadcn';
import { Tree, TreeDragLine, TreeItem, TreeItemLabel } from '@teable/ui-lib/src/shadcn/ui/tree';
import { FolderIcon, FolderOpenIcon } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useClickAway, useLocalStorage } from 'react-use';
import { Emoji } from '@/features/app/components/emoji/Emoji';
import { EmojiPicker } from '@/features/app/components/emoji/EmojiPicker';
import { useTableHref } from '../../table-list/useTableHref';
import { BaseNodeContext } from '../base-node/BaseNodeContext';
import {
  BaseNodeResourceIconMap,
  getNodeUrl,
  parseNodeUrl,
  ROOT_ID,
  useBaseNodeCrud,
} from '../base-node/hooks';
import type { TreeItemData } from '../base-node/hooks';
import { BaseNodeAddResourceButton } from './BaseNodeAddResourceButton';
import { BaseNodeMore } from './BaseNodeMore';
import { BaseNodeStarButton } from './BaseNodeStarButton';

const INDENTATION_WIDTH = 16;

export const BaseNodeTree = () => {
  const { t } = useTranslation(['common']);
  const baseId = useBaseId() as string;
  const router = useRouter();
  const tableHrefMap = useTableHref();
  const permission = useBasePermission();
  const { confirm } = useConfirm();
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const urlParams = useParams<{
    dashboardId?: string;
    automationId?: string;
    appId?: string;
    tableId?: string;
  }>();
  const { maxFolderDepth, treeItems, setTreeItems } = useContext(BaseNodeContext);
  const curdHooks = useBaseNodeCrud();
  const draggedItemsRef = useRef<ItemInstance<TreeItemData>[]>([]);
  const treeItemsRef = useRef(treeItems);
  const [expandedItems, setExpandedItems] = useLocalStorage<string[]>(
    LocalStorageKeys.BaseNodeExpandedItems,
    []
  );
  const canMoveNode = Boolean(permission?.['base|update']);
  const canCreateFolder = Boolean(permission?.['base|update']);

  const handleDrop = (items: ItemInstance<TreeItemData>[], target: DragTarget<TreeItemData>) => {
    const handler = createOnDropHandler<TreeItemData>((parentItem, newChildrenIds) => {
      console.log('setTreeItems', parentItem.getId(), newChildrenIds);
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

          if (newIndex > 0) {
            anchorId = newChildrenIds[newIndex - 1];
            position = 'after';
          } else if (newChildrenIds.length > 1) {
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

  const handlePrimaryAction = useCallback(
    (item: ItemInstance<TreeItemData>) => {
      const node = item.getItemData();
      const viewId = router.query.viewId as string;

      // fixme todo
      if (node.resourceType === BaseNodeResourceType.Table) {
        if (!tableHrefMap[node.resourceId]) {
          console.error('tableHrefMap[node.resourceId] not found', node.resourceId);
          return;
        }
        router.push(
          {
            pathname: tableHrefMap[node.resourceId],
          },
          undefined,
          {
            shallow: Boolean(viewId),
          }
        );
        return;
      }
      const url = getNodeUrl({
        baseId,
        resourceType: node.resourceType,
        resourceId: node.resourceId,
      });
      router.push(url, undefined, {
        shallow: true,
      });
    },
    [baseId, router, tableHrefMap]
  );

  const activeId = useMemo(() => {
    if (Object.keys(treeItems).length === 0) return null;
    const nodes = Object.values(treeItems);
    const { resourceType, resourceId } =
      parseNodeUrl({ baseId, url: router.asPath, urlParams }) ?? {};
    return (
      nodes.find((node) => node.resourceType === resourceType && node.resourceId === resourceId)
        ?.id ?? null
    );
  }, [treeItems, router.asPath, urlParams, baseId]);

  useEffect(() => {
    treeItemsRef.current = treeItems;
  }, [treeItems]);

  const tree = useTree<TreeItemData>({
    state: {
      selectedItems: activeId ? [activeId] : [],
      expandedItems,
    },
    setExpandedItems: (updater) => {
      setExpandedItems((prev) => {
        return typeof updater === 'function' ? updater(prev ?? []) : updater;
      });
    },
    rootItemId: ROOT_ID,
    indent: INDENTATION_WIDTH,
    dataLoader: {
      getItem: (itemId) => treeItemsRef.current[itemId],
      getChildren: (itemId) => treeItemsRef.current[itemId]?.children ?? [],
    },
    getItemName: (item) => item.getItemData().name,
    isItemFolder: (item) => item.getItemData().resourceType === BaseNodeResourceType.Folder,
    canReorder: true,
    canDrop: (_, target) => canMoveNode && target.item.isFolder(),
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

  useEffect(() => {
    if (!Object.keys(treeItems).length) return;
    tree.rebuildTree();
  }, [tree, treeItems]);

  useEffect(() => {
    let timeout: NodeJS.Timeout | null = null;
    if (editingNodeId) {
      timeout = setTimeout(() => inputRef.current?.focus());
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
      setTreeItems((prevItems) => ({
        ...prevItems,
        [nodeId]: {
          ...prevItems[nodeId],
          name: newVal,
        },
      }));
      curdHooks.updateNode(nodeId, {
        name: newVal,
      });
    };
    if (editingNodeId) {
      update(editingNodeId);
      setEditingNodeId(null);
    }
  });

  if (!baseId) {
    return null;
  }

  return (
    <div className="flex w-full flex-col gap-2 overflow-auto pt-4">
      <BaseNodeAddResourceButton
        curdHooks={curdHooks}
        parentId={ROOT_ID}
        canCreateFolder={canCreateFolder}
      >
        <div className="px-3">
          <Button variant={'outline'} size={'xs'} className="w-full">
            <AddBoldIcon />
          </Button>
        </div>
      </BaseNodeAddResourceButton>
      <Tree indent={INDENTATION_WIDTH} tree={tree}>
        <AssistiveTreeDescription tree={tree} />
        {tree.getItems().map((item) => {
          const nodeId = item.getId();
          const data = item.getItemData();
          if (!data) return null;
          const IconComponent = BaseNodeResourceIconMap[data.resourceType];
          const { resourceType, resourceId, name, icon } = data;
          return (
            <TreeItem key={nodeId} item={item}>
              <TreeItemLabel>
                <div className="flex w-full items-center gap-2">
                  {item.isFolder() && <IconComponent className="size-4 shrink-0" />}
                  {!item.isFolder() && (
                    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
                    <div className="cursor-pointer" onClick={(e) => e.stopPropagation()}>
                      <EmojiPicker
                        className="flex size-5 items-center justify-center hover:bg-muted-foreground/60"
                        onChange={(icon: string) => curdHooks.updateNode(nodeId, { icon })}
                      >
                        {icon ? (
                          <Emoji emoji={icon} size={'1rem'} />
                        ) : (
                          <IconComponent className="size-4 shrink-0" />
                        )}
                      </EmojiPicker>
                    </div>
                  )}
                  {editingNodeId === nodeId ? (
                    <Input
                      ref={inputRef}
                      type="text"
                      placeholder="name"
                      defaultValue={item.getItemName()}
                      style={{
                        boxShadow: 'none',
                      }}
                      className="round-none h-full cursor-text bg-background px-4 outline-none"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const newVal = e.currentTarget.value;
                          if (newVal && newVal !== item.getItemName()) {
                            curdHooks.updateNode(nodeId, { name: newVal });
                          }
                          setEditingNodeId(null);
                        }
                      }}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                      }}
                    />
                  ) : (
                    <p className="grow truncate text-left">{' ' + item.getItemName()}</p>
                  )}
                  {
                    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                      className="flex cursor-pointer items-center gap-2"
                    >
                      <div className="opacity-0 group-hover:opacity-100 group-data-[folder=false]:hidden  group-data-[selected=true]:opacity-100">
                        <BaseNodeAddResourceButton
                          curdHooks={curdHooks}
                          parentId={nodeId === ROOT_ID ? undefined : nodeId}
                          canCreateFolder={
                            canCreateFolder && checkCanCreateFolder(item, maxFolderDepth)
                          }
                        >
                          <Button variant={'ghost'} size={'xs'} className="size-4 p-0">
                            <AddBoldIcon className="size-full" />
                          </Button>
                        </BaseNodeAddResourceButton>
                      </div>
                      <BaseNodeStarButton resourceType={resourceType} resourceId={resourceId} />
                      <div className="opacity-0 group-hover:opacity-100 group-data-[selected=true]:opacity-100">
                        <BaseNodeMore
                          resourceType={resourceType}
                          resourceId={resourceId}
                          className="size-4 shrink-0 sm:opacity-0 sm:group-hover:opacity-100"
                          onRename={() => setEditingNodeId(nodeId)}
                          onDelete={async () => {
                            const result = await confirm({
                              title: t('common:actions.delete'),
                              description: t('common:actions.deleteTip', {
                                name,
                              }),
                              confirmText: t('common:actions.delete'),
                              cancelText: t('common:actions.cancel'),
                              confirmButtonVariant: 'destructive',
                            });
                            if (result) {
                              const aboveItem = item.getItemAbove();
                              const belowItem = item.getItemBelow();
                              await curdHooks.deleteNode(nodeId);
                              if (activeId !== nodeId) {
                                return;
                              }
                              if (belowItem) {
                                handlePrimaryAction(belowItem);
                              } else if (aboveItem) {
                                handlePrimaryAction(aboveItem);
                              } else {
                                router.push(`/base/${baseId}`, undefined, { shallow: true });
                              }
                            }
                          }}
                          onDuplicate={() => curdHooks.duplicateNode(nodeId, { name })}
                        />
                      </div>
                    </div>
                  }
                </div>
              </TreeItemLabel>
            </TreeItem>
          );
        })}
        <TreeDragLine />
      </Tree>
    </div>
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
