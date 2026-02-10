import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { hasPermission } from '@teable/core';
import { ChevronDown, Clock4, LayoutList } from '@teable/icons';
import {
  deleteBase,
  getSpaceById,
  permanentDeleteBase,
  updateBase,
  updateBaseOrder,
  type IGetBaseVo,
  type IGetBaseAllVo,
} from '@teable/openapi';
import { LocalStorageKeys, ReactQueryKeys } from '@teable/sdk/config';
import { AnchorContext } from '@teable/sdk/context';
import { useIsHydrated } from '@teable/sdk/hooks';
import type { DragEndEvent } from '@teable/ui-lib/base';
import { Spin } from '@teable/ui-lib/base';
import {
  Collapsible,
  CollapsibleContent,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  Skeleton,
  cn,
} from '@teable/ui-lib/shadcn';
import { keyBy } from 'lodash';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useState, useMemo, useCallback } from 'react';
import { useLocalStorage } from 'react-use';
import { spaceConfig } from '@/features/i18n/space.config';
import { BaseNodeProvider } from '../base/base-node/BaseNodeProvider';
import { getNodeUrl } from '../base/base-node/hooks';
import { BaseNodeTree } from '../base/base-side-bar/BaseNodeTree';
import { useLastVisitBase } from '../base/hooks';
import { BaseItem } from './BaseItem';
import { DraggableBaseRows } from './DraggableBaseRows';
import { useBaseList } from './useBaseList';

enum ViewMode {
  Recent = 'recent',
  Manual = 'manual',
}

interface IBaseListProps {
  baseIds: string[];
  spaceId?: string;
  showToolbar?: boolean;
}

export const BaseList = (props: IBaseListProps) => {
  const { baseIds, spaceId, showToolbar = false } = props;
  const { t } = useTranslation(spaceConfig.i18nNamespaces);
  const router = useRouter();
  const queryClient = useQueryClient();
  const [expandedBases, setExpandedBases] = useState<Set<string>>(new Set());

  const isHydrated = useIsHydrated();
  const [viewModeMap, setViewModeMap] = useLocalStorage<Record<string, ViewMode>>(
    LocalStorageKeys.SpaceBaseListViewMode,
    {}
  );
  const viewMode = viewModeMap?.[spaceId || ''] ?? ViewMode.Recent;
  const isManual = isHydrated && viewMode === ViewMode.Manual;

  const setViewMode = useCallback(
    (mode: ViewMode) => {
      if (!spaceId) return;
      setViewModeMap((prev) => ({
        ...prev,
        [spaceId]: mode,
      }));
    },
    [spaceId, setViewModeMap]
  );

  const allBaseList = useBaseList();
  const { map: lastVisitBaseMap = {} } = useLastVisitBase();

  const { data: space } = useQuery({
    queryKey: ReactQueryKeys.space(spaceId!),
    queryFn: ({ queryKey }) => getSpaceById(queryKey[1]).then((res) => res.data),
    enabled: !!spaceId,
  });
  const canReorder = space && hasPermission(space.role, 'base|update');

  const { mutate: updateOrder } = useMutation({
    mutationFn: updateBaseOrder,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.baseAll() });
    },
  });

  const allBaseMap = useMemo(() => {
    return keyBy(allBaseList, 'id');
  }, [allBaseList]);

  // Get all bases in their stored order (backend returns sorted by base.order)
  const orderedBases = useMemo(() => {
    return baseIds
      .map((baseId) => {
        const base = allBaseMap[baseId];
        if (!base) return null;
        return {
          ...base,
          lastVisitTime: lastVisitBaseMap[baseId]?.lastVisitTime,
        };
      })
      .filter((item) => item !== null) as (IGetBaseVo & { lastVisitTime?: string })[];
  }, [baseIds, allBaseMap, lastVisitBaseMap]);

  // Sort bases by recent visit time
  const sortedRecentList = useMemo(() => {
    const withTime = baseIds
      .map((baseId) => {
        const base = allBaseMap[baseId];
        if (!base) return null;
        const lastVisitTime = lastVisitBaseMap[baseId]?.lastVisitTime;

        return {
          ...base,
          lastVisitTime,
        };
      })
      .filter((item) => item !== null) as (IGetBaseVo & { lastVisitTime?: string })[];

    /**
     * 1. Both have lastVisitTime: compare by lastVisitTime (recent first)
     * 2. One has lastVisitTime: prioritize the one with lastVisitTime
     * 3. Both have lastModifiedTime: compare by lastModifiedTime (recent first)
     * 4. One has lastModifiedTime: prioritize the one with lastModifiedTime
     * 5. Finally, sort by createdTime (recent first)
     */
    return withTime.sort((a, b) => {
      if (a.lastVisitTime && b.lastVisitTime) {
        return new Date(b.lastVisitTime).getTime() - new Date(a.lastVisitTime).getTime();
      }

      if (a.lastVisitTime && !b.lastVisitTime) return -1;
      if (!a.lastVisitTime && b.lastVisitTime) return 1;

      if (a.lastModifiedTime && b.lastModifiedTime) {
        return new Date(b.lastModifiedTime).getTime() - new Date(a.lastModifiedTime).getTime();
      }

      if (a.lastModifiedTime && !b.lastModifiedTime) return -1;
      if (!a.lastModifiedTime && b.lastModifiedTime) return 1;

      const aCreated = a.createdTime ? new Date(a.createdTime).getTime() : 0;
      const bCreated = b.createdTime ? new Date(b.createdTime).getTime() : 0;
      return bCreated - aCreated;
    });
  }, [baseIds, allBaseMap, lastVisitBaseMap]);

  // Get list based on view mode
  const currentList = viewMode === ViewMode.Manual ? orderedBases : sortedRecentList;

  const { mutate: updateBaseMutator } = useMutation({
    mutationFn: updateBase,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.baseAll() });
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.recentlyBase() });
    },
  });

  const { mutate: deleteBaseMutator } = useMutation({
    mutationFn: ({ baseId, permanent }: { baseId: string; permanent?: boolean }) =>
      permanent ? permanentDeleteBase(baseId) : deleteBase(baseId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.baseAll() });
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.recentlyBase() });
    },
  });

  const intoBase = (baseId: string) => {
    router.push(`/base/${baseId}`);
  };

  const toggleExpanded = (baseId: string) => {
    setExpandedBases((prev) => {
      const next = new Set(prev);
      next.has(baseId) ? next.delete(baseId) : next.add(baseId);
      return next;
    });
  };

  // Handle drag end for manual order view reordering
  const onDragEndHandler = async (event: DragEndEvent) => {
    const { over, active } = event;
    const to = over?.data?.current?.sortable?.index;
    const from = active?.data?.current?.sortable?.index;

    if (!over || from === to || from === undefined || to === undefined) {
      return;
    }

    const draggedBase = currentList[from];

    // 1. Compute the reordered list to get the expected final result
    const reorderedList = [...currentList];
    const [removed] = reorderedList.splice(from, 1);
    reorderedList.splice(to, 0, removed);

    // 2. Determine anchor and position based on the reordered list
    const newIndex = reorderedList.findIndex((b) => b.id === draggedBase.id);
    const anchorId = newIndex === 0 ? reorderedList[1].id : reorderedList[newIndex - 1].id;
    const position = newIndex === 0 ? 'before' : 'after';

    // 3. Call API
    updateOrder({
      baseId: draggedBase.id,
      anchorId,
      position,
    });

    // 4. Optimistic update for baseAll query
    queryClient.setQueryData(ReactQueryKeys.baseAll(), (prev: IGetBaseAllVo | undefined) => {
      if (!prev) return [];
      const newList = [...prev];
      const draggedIndex = newList.findIndex((b) => b.id === draggedBase.id);
      const anchorIndex = newList.findIndex((b) => b.id === anchorId);
      if (draggedIndex === -1 || anchorIndex === -1) return newList;

      const [movedItem] = newList.splice(draggedIndex, 1);
      // Adjust anchor index after removal, then insert based on position
      const adjustedAnchorIndex = draggedIndex < anchorIndex ? anchorIndex - 1 : anchorIndex;
      const insertIndex = position === 'after' ? adjustedAnchorIndex + 1 : adjustedAnchorIndex;
      newList.splice(insertIndex, 0, movedItem);
      return newList;
    });
  };

  const renderBaseRow = (
    base: IGetBaseVo & { lastVisitTime?: string },
    options?: {
      showDragHandle?: boolean;
      isDragging?: boolean;
      listeners?: Record<string, unknown>;
    }
  ) => {
    const showDragHandle = options?.showDragHandle && canReorder;

    return (
      <Collapsible
        key={base.id}
        open={expandedBases.has(base.id)}
        onOpenChange={() => toggleExpanded(base.id)}
      >
        <BaseItem
          base={base}
          lastVisitTime={lastVisitBaseMap[base.id]?.lastVisitTime}
          isExpanded={expandedBases.has(base.id)}
          showDragHandle={showDragHandle}
          dragHandleListeners={showDragHandle ? options?.listeners : undefined}
          onToggleExpand={() => toggleExpanded(base.id)}
          onEnterBase={() => intoBase(base.id)}
          onUpdate={(data) => updateBaseMutator({ baseId: base.id, updateBaseRo: data })}
          onDelete={(permanent) => deleteBaseMutator({ baseId: base.id, permanent })}
        />
        <CollapsibleContent>
          <AnchorContext.Provider value={{ baseId: base.id }}>
            <BaseNodeProvider isRestrictedAuthority={base.restrictedAuthority}>
              <div className={cn('bg-muted', isManual ? 'px-8' : 'px-2')}>
                <BaseNodeTree
                  mode="view"
                  emptyText={t('space:baseList.noTables')}
                  skeleton={
                    <div className="flex w-full flex-col items-center justify-center gap-2 p-2">
                      <Spin className="size-4" />
                    </div>
                  }
                  onPrimaryAction={(item) => {
                    const node = item.getItemData();
                    const { resourceType, resourceId } = node;
                    const url = getNodeUrl({
                      baseId: base.id,
                      resourceType,
                      resourceId,
                    });
                    if (url) {
                      router.push(url);
                    }
                  }}
                />
              </div>
            </BaseNodeProvider>
          </AnchorContext.Provider>
        </CollapsibleContent>
      </Collapsible>
    );
  };
  return (
    <ScrollArea className="h-full !border-none bg-background [&>[data-radix-scroll-area-viewport]>div]:!block [&>[data-radix-scroll-area-viewport]>div]:!min-h-0 [&>[data-radix-scroll-area-viewport]>div]:!min-w-0">
      {/* Toolbar: View Mode Select */}
      {showToolbar && (
        <div className="sticky top-0 z-10 flex items-center gap-4 bg-background">
          {isHydrated ? (
            <Select value={viewMode} onValueChange={(value) => setViewMode(value as ViewMode)}>
              <SelectTrigger className="h-8 w-auto gap-1 border-none bg-transparent shadow-none hover:bg-accent hover:text-accent-foreground focus:ring-0 dark:bg-transparent [&>svg]:hidden">
                <div className="flex items-center gap-1">
                  {viewMode === ViewMode.Recent ? (
                    <Clock4 className="size-3.5" />
                  ) : (
                    <LayoutList className="size-3.5" />
                  )}
                  <span>
                    {viewMode === ViewMode.Recent
                      ? t('space:baseList.recent')
                      : t('space:baseList.manual')}
                  </span>
                  <ChevronDown className="size-4 opacity-50" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recent">
                  <div className="flex items-center gap-1">
                    <Clock4 className="size-3.5" />
                    {t('space:baseList.recent')}
                  </div>
                </SelectItem>
                <SelectItem value="manual">
                  <div className="flex items-center gap-1">
                    <LayoutList className="size-3.5" />
                    {t('space:baseList.manual')}
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <Skeleton className="h-6 w-24" />
          )}
        </div>
      )}

      {/* Header */}
      <div
        className={cn(
          'sticky z-10 flex h-8 items-center border-b bg-background text-xs font-medium text-muted-foreground',
          showToolbar ? 'top-8' : 'top-0'
        )}
      >
        <div className="flex-1 truncate pl-6 pr-2">{t('space:baseList.allBases')}</div>
        <div className="hidden shrink-0 px-2 sm:block sm:w-24">{t('space:baseList.owner')}</div>
        <div className="hidden w-24 shrink-0 px-2 sm:block">{t('space:baseList.createdTime')}</div>
        <div className="hidden w-32 shrink-0 px-2 sm:block">{t('space:baseList.lastOpened')}</div>
      </div>

      {/* Rows */}
      {!isHydrated ? (
        <div className="divide-y">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex h-12 items-center px-6">
              <Skeleton className="h-4 w-48" />
            </div>
          ))}
        </div>
      ) : isManual ? (
        <DraggableBaseRows
          items={currentList}
          onDragEnd={onDragEndHandler}
          renderRow={renderBaseRow}
        />
      ) : (
        <div className="divide-y">{currentList.map((base) => renderBaseRow(base))}</div>
      )}

      {/* Empty state */}
      {isHydrated && currentList.length === 0 && (
        <div className="flex h-40 items-center justify-center text-muted-foreground">
          {t('space:baseList.empty')}
        </div>
      )}
    </ScrollArea>
  );
};
