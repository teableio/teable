import { useQueryClient } from '@tanstack/react-query';
import { useBaseId, useTableId, useViewId } from '@teable/sdk/hooks';
import { useCallback } from 'react';
import { useAI } from '@/features/app/hooks/useAI';
import { useBaseUsage } from '@/features/app/hooks/useBaseUsage';
import { useDisableAIAction } from '@/features/app/hooks/useDisableAIAction';
import { cacheRecordForChat } from '../grid/utils/gridSelectionChat';

/**
 * Record menu "Add to Chat" for the views that render their own record menus.
 *
 * The reference travels through the same cache the grid selection and the expanded
 * record write, so the chat chip carries this record's id instead of a grid row.
 * `cacheRecordForChat` also opens the panel without sending anything.
 */
export const useAddToChat = () => {
  const baseId = useBaseId();
  const tableId = useTableId();
  const viewId = useViewId();
  const queryClient = useQueryClient();
  const { enable: aiEnable } = useAI();
  const { aiChat } = useDisableAIAction();
  const usage = useBaseUsage({ disabled: !baseId });
  // Match the expanded record menu, including the administrator's chat switch.
  const chatEnabled = Boolean(aiEnable && usage?.limit?.chatAIEnable && aiChat);

  const addToChat = useCallback(
    (recordId?: string) => {
      if (!baseId || !tableId || !recordId) return;
      cacheRecordForChat(queryClient, baseId, { tableId, viewId, recordId });
    },
    [baseId, tableId, viewId, queryClient]
  );

  return { chatEnabled, addToChat };
};
