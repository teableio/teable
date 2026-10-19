import { useQueryClient } from '@tanstack/react-query';
import { ExpandRecordAddToChatContext, type IExpandRecordAddToChatArgs } from '@teable/sdk';
import { useBaseId } from '@teable/sdk/hooks';
import { useCallback, useMemo, type ReactNode } from 'react';
import { cacheRecordForChat } from '@/features/app/blocks/view/grid/utils/gridSelectionChat';
import { useAI } from '@/features/app/hooks/useAI';
import { useBaseUsage } from '@/features/app/hooks/useBaseUsage';
import { useDisableAIAction } from '@/features/app/hooks/useDisableAIAction';

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
      // The expanded record already supplies stable table and record identities.
      cacheRecordForChat(queryClient, baseId, {
        tableId: args.tableId,
        viewId: args.viewId,
        recordId: args.recordId,
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
