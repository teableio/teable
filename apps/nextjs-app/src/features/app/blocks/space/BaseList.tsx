import { useQueryClient, useMutation } from '@tanstack/react-query';
import { deleteBase, permanentDeleteBase, updateBase, type IGetBaseVo } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { AnchorContext } from '@teable/sdk/context';
import { Spin } from '@teable/ui-lib/base';
import { Collapsible, CollapsibleContent, ScrollArea } from '@teable/ui-lib/shadcn';
import { keyBy } from 'lodash';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useState, useMemo } from 'react';
import { spaceConfig } from '@/features/i18n/space.config';
import { useChatPanelStore } from '../../components/sidebar/useChatPanelStore';
import { BaseNodeProvider } from '../base/base-node/BaseNodeProvider';
import { getNodeUrl } from '../base/base-node/hooks';
import { BaseNodeTree } from '../base/base-side-bar/BaseNodeTree';
import { useLastVisitBase } from '../base/hooks';
import { BaseItem } from './BaseItem';
import { useBaseList } from './useBaseList';
interface IBaseListProps {
  baseIds: string[];
}

export const BaseList = (props: IBaseListProps) => {
  const { baseIds } = props;
  const { t } = useTranslation(spaceConfig.i18nNamespaces);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { open: openChatPanel } = useChatPanelStore();
  const [expandedBases, setExpandedBases] = useState<Set<string>>(new Set());

  const allBaseList = useBaseList();
  const { map: lastVisitBaseMap = {} } = useLastVisitBase();

  const allBaseMap = useMemo(() => {
    return keyBy(allBaseList, 'id');
  }, [allBaseList]);

  const sortedList = useMemo(() => {
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
    openChatPanel();
    router.push(`/base/${baseId}`);
  };

  const toggleExpanded = (baseId: string) => {
    setExpandedBases((prev) => {
      const next = new Set(prev);
      next.has(baseId) ? next.delete(baseId) : next.add(baseId);
      return next;
    });
  };

  const renderBaseRow = (base: IGetBaseVo) => (
    <Collapsible
      key={base.id}
      open={expandedBases.has(base.id)}
      onOpenChange={() => toggleExpanded(base.id)}
    >
      <BaseItem
        base={base}
        lastVisitTime={lastVisitBaseMap[base.id]?.lastVisitTime}
        isExpanded={expandedBases.has(base.id)}
        onToggleExpand={() => toggleExpanded(base.id)}
        onEnterBase={() => intoBase(base.id)}
        onUpdate={(data) => updateBaseMutator({ baseId: base.id, updateBaseRo: data })}
        onDelete={(permanent) => deleteBaseMutator({ baseId: base.id, permanent })}
      />
      <CollapsibleContent>
        <AnchorContext.Provider value={{ baseId: base.id }}>
          <BaseNodeProvider>
            <div className="bg-muted">
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

  return (
    <ScrollArea className="h-full !border-none bg-background [&>[data-radix-scroll-area-viewport]>div]:!block [&>[data-radix-scroll-area-viewport]>div]:!min-h-0 [&>[data-radix-scroll-area-viewport]>div]:!min-w-0">
      {/* Header */}
      <div className="sticky top-0 z-10 flex h-8 items-center border-b bg-background text-xs font-medium text-muted-foreground">
        <div className="flex-1 truncate pl-6 pr-2">{t('space:baseList.allBases')}</div>
        <div className="hidden shrink-0 px-2 sm:block sm:w-40">{t('space:baseList.owner')}</div>
        <div className="hidden w-32 shrink-0 px-2 sm:block">{t('space:baseList.lastOpened')}</div>
      </div>

      {/* Rows */}
      {<div className="divide-y">{sortedList.map((base) => renderBaseRow(base))}</div>}

      {sortedList.length === 0 && (
        <div className="flex h-40 items-center justify-center text-muted-foreground">
          {t('space:baseList.empty')}
        </div>
      )}
    </ScrollArea>
  );
};
