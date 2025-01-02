import { useQuery } from '@tanstack/react-query';
import { getPublicSetting } from '@teable/openapi';

export function useAI() {
  const { data } = useQuery({
    queryKey: ['public-setting'],
    queryFn: () => getPublicSetting().then(({ data }) => data),
  });

  return {
    enable: data?.aiConfig?.enable ?? false,
  };
}
