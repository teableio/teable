import { useQuery } from '@tanstack/react-query';
import { getAIConfig } from '@teable/openapi';
import { useBaseId, useIsReadOnlyPreview } from '@teable/sdk/hooks';
import { useMemo } from 'react';
import { AIActions } from '../blocks/admin/setting/components/ai-config/AIControlCard';

export const useDisableAIAction = () => {
  const baseId = useBaseId();
  const isReadOnlyPreview = useIsReadOnlyPreview();
  const { data, isFetched, isError, isSuccess } = useQuery({
    queryKey: ['ai-config', baseId],
    queryFn: () => getAIConfig(baseId!).then(({ data }) => data),
    enabled: !!baseId && !isReadOnlyPreview,
  });
  // An empty `ai/config` means the base has no AI configured, so no AI action can run.
  const isAIUnset = isSuccess && !data;
  const disableActions = data ? data.disableActions : undefined;

  return useMemo(() => {
    const isSettled = isFetched || !baseId || isReadOnlyPreview;
    const isReady = isFetched && !isError;
    if (isAIUnset) {
      return { aiField: false, aiChat: false, isSettled, isReady };
    }
    if (Array.isArray(disableActions) && disableActions.length > 0) {
      return {
        aiField: !disableActions.includes(AIActions.AIField),
        aiChat: !disableActions.includes(AIActions.AIChat),
        isSettled,
        isReady,
      };
    }
    return { aiField: true, aiChat: true, isSettled, isReady };
  }, [baseId, disableActions, isAIUnset, isError, isFetched, isReadOnlyPreview]);
};
