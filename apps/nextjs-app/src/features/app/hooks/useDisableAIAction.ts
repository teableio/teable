import { useQuery } from '@tanstack/react-query';
import { getAIDisableActions } from '@teable/openapi';
import { useBaseId } from '@teable/sdk/hooks';
import { useMemo } from 'react';
import { AIActions } from '../blocks/admin/setting/components/ai-config/AIControlCard';

export const useDisableAIAction = () => {
  const baseId = useBaseId();
  const { data: { disableActions } = {} } = useQuery({
    queryKey: ['disable-ai-actions', baseId],
    queryFn: () => getAIDisableActions(baseId!).then((res) => res.data),
    enabled: !!baseId,
  });

  return useMemo(() => {
    if (Array.isArray(disableActions) && disableActions.length > 0) {
      return {
        suggestion: !disableActions.includes(AIActions.Suggestion),
        buildBase: !disableActions.includes(AIActions.BuildBase),
        buildAutomation: !disableActions.includes(AIActions.BuildAutomation),
        baseResource: !disableActions.includes(AIActions.BaseResource),
        buildApp: !disableActions.includes(AIActions.BaseApp),
      };
    }
    return {
      suggestion: true,
      buildBase: true,
      baseResource: true,
      buildAutomation: true,
      buildApp: true,
    };
  }, [disableActions]);
};
