import { useQueryClient } from '@tanstack/react-query';
import { getRecordIndex } from '@teable/openapi';
import { ExpandRecordAddToChatContext, type IExpandRecordAddToChatArgs } from '@teable/sdk';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBaseId } from '@teable/sdk/hooks';
import { useCallback, useMemo, type ReactNode } from 'react';
import { useGridSearchStore } from '@/features/app/blocks/view/grid/useGridSearchStore';
import { cacheRecordIndexForChat } from '@/features/app/blocks/view/grid/utils/gridSelectionChat';
import { useAI } from '@/features/app/hooks/useAI';
import { useBaseUsage } from '@/features/app/hooks/useBaseUsage';
import { useDisableAIAction } from '@/features/app/hooks/useDisableAIAction';
import {
  recordIndexFallbackQuery,
  recordIndexQueryForAddToChat,
  type IAddToChatActiveView,
} from './recordIndexQueryForAddToChat';

export const ExpandRecordAddToChatProvider = ({ children }: { children: ReactNode }) => {
  const baseId = useBaseId();
  const queryClient = useQueryClient();
  const { enable: aiEnable } = useAI();
  const { aiChat } = useDisableAIAction();
  const usage = useBaseUsage({ disabled: !baseId });
  const chatEnabled = Boolean(aiEnable && usage?.limit?.chatAIEnable && aiChat);

  const addToChat = useCallback(
    (args: IExpandRecordAddToChatArgs) => {
      if (!baseId) return;
      const resource = {
        tableId: args.tableId,
        viewId: args.viewId,
        recordId: args.recordId,
      };
      const recordMap = args.preferLoadedIndex
        ? useGridSearchStore.getState().recordMap
        : undefined;
      const indexKey = recordMap
        ? Object.keys(recordMap).find((key) => recordMap[key]?.id === args.recordId)
        : undefined;
      const fromGrid = indexKey == null ? undefined : Number(indexKey);
      if (fromGrid != null && !Number.isNaN(fromGrid)) {
        cacheRecordIndexForChat(queryClient, baseId, fromGrid, resource);
        return;
      }
      const active = queryClient.getQueryData<IAddToChatActiveView>(
        ReactQueryKeys.activeViewContext(baseId)
      );
      const indexQuery = recordIndexQueryForAddToChat(
        {
          tableId: args.tableId,
          recordId: args.recordId,
          viewId: args.viewId,
          search: args.search,
        },
        active
      );
      void getRecordIndex(args.tableId, indexQuery)
        .then(async ({ data }) => {
          let index = data?.index;
          const fallback = index == null ? recordIndexFallbackQuery(indexQuery) : undefined;
          if (fallback) {
            index = (await getRecordIndex(args.tableId, fallback)).data?.index;
          }
          cacheRecordIndexForChat(queryClient, baseId, index, resource);
        })
        .catch(() => {
          cacheRecordIndexForChat(queryClient, baseId, undefined, resource);
        });
    },
    [baseId, queryClient]
  );

  const value = useMemo(
    () => (chatEnabled && baseId ? { addToChat } : {}),
    [addToChat, baseId, chatEnabled]
  );

  return (
    <ExpandRecordAddToChatContext.Provider value={value}>
      {children}
    </ExpandRecordAddToChatContext.Provider>
  );
};
