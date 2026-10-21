import { useQueryClient } from '@tanstack/react-query';
import { useBaseId, useTableId, useViewId } from '@teable/sdk/hooks';
import { useCallback } from 'react';
import { useAI } from '@/features/app/hooks/useAI';
import { useBaseUsage } from '@/features/app/hooks/useBaseUsage';
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
  const usage = useBaseUsage({ disabled: !baseId });
  // Same availability gate as the grid record menu: no entry without AI chat in this base.
  const chatEnabled = Boolean(aiEnable && usage?.limit?.chatAIEnable);

  const addToChat = useCallback(
    (recordId?: string) => {
      if (!baseId || !tableId || !recordId) return;
      cacheRecordForChat(queryClient, baseId, { tableId, viewId, recordId });
    },
    [baseId, tableId, viewId, queryClient]
  );

  return { chatEnabled, addToChat };
};
