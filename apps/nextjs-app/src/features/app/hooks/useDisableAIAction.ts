import { useQuery } from '@tanstack/react-query';
import { getAIDisableActions } from '@teable/openapi';
import { useBaseId, useIsReadOnlyPreview } from '@teable/sdk/hooks';
import { useMemo } from 'react';
import { AIActions } from '../blocks/admin/setting/components/ai-config/AIControlCard';

export const useDisableAIAction = () => {
  const baseId = useBaseId();
  const isReadOnlyPreview = useIsReadOnlyPreview();
  const {
    data: { disableActions } = {},
    isFetched,
    isError,
  } = useQuery({
    queryKey: ['disable-ai-actions', baseId],
    queryFn: () => getAIDisableActions(baseId!).then((res) => res.data),
    enabled: !!baseId && !isReadOnlyPreview,
  });

  return useMemo(() => {
    if (Array.isArray(disableActions) && disableActions.length > 0) {
      return {
        aiField: !disableActions.includes(AIActions.AIField),
        aiChat: !disableActions.includes(AIActions.AIChat),
        isSettled: isFetched || !baseId || isReadOnlyPreview,
        isReady: isFetched && !isError,
      };
    }
    return {
      aiField: true,
      aiChat: true,
      isSettled: isFetched || !baseId || isReadOnlyPreview,
      isReady: isFetched && !isError,
    };
  }, [baseId, disableActions, isError, isFetched, isReadOnlyPreview]);
};
