import { useQuery } from '@tanstack/react-query';
import { getAIConfig } from '@teable/openapi';
import { useBaseId, useIsReadOnlyPreview } from '@teable/sdk/hooks';

export function useAI() {
  const baseId = useBaseId() as string;
  const isReadOnlyPreview = useIsReadOnlyPreview();
  const { data } = useQuery({
    queryKey: ['ai-config', baseId],
    queryFn: () => getAIConfig(baseId).then(({ data }) => data),
    enabled: Boolean(baseId) && !isReadOnlyPreview,
  });

  return {
    enable: Boolean(data),
  };
}
