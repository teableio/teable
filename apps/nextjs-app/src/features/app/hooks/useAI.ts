import { useQuery } from '@tanstack/react-query';
import { getAIConfig } from '@teable/openapi';
import { useBaseId } from '@teable/sdk/hooks';

export function useAI() {
  const baseId = useBaseId() as string;
  const { data } = useQuery({
    queryKey: ['ai-config', baseId],
    queryFn: () => getAIConfig(baseId).then(({ data }) => data),
  });

  return {
    enable: Boolean(data),
  };
}
