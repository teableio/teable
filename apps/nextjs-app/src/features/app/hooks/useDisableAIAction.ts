import { useQuery } from '@tanstack/react-query';
import { getAIDisableActions } from '@teable/openapi';
import { useBaseId } from '@teable/sdk/hooks';
import { useMemo } from 'react';
import { AIActions } from '../blocks/admin/setting/components/ai-config/AIControlCard';

export const useDisableAIAction = () => {
  const baseId = useBaseId();
  const { data: { disableAIActions } = {} } = useQuery({
    queryKey: ['disable-ai-actions', baseId],
    queryFn: () => getAIDisableActions(baseId!).then((res) => res.data),
    enabled: !!baseId,
  });

  return useMemo(() => {
    if (Array.isArray(disableAIActions) && disableAIActions.length > 0) {
      return {
        suggestion: !disableAIActions.includes(AIActions.Suggestion),
        buildBase: !disableAIActions.includes(AIActions.BuildBase),
        buildAutomation: !disableAIActions.includes(AIActions.BuildAutomation),
        baseResource: !disableAIActions.includes(AIActions.BaseResource),
        buildApp: !disableAIActions.includes(AIActions.BaseApp),
      };
    }
    return {
      suggestion: true,
      buildBase: true,
      baseResource: true,
      buildAutomation: true,
      buildApp: true,
    };
  }, [disableAIActions]);
};
