import { useQuery } from '@tanstack/react-query';
import { getBaseAll } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';

export const useBaseList = (enabled = true) => {
  const { data: baseList } = useQuery({
    queryKey: ReactQueryKeys.baseAll(),
    queryFn: () => getBaseAll().then((res) => res.data),
    enabled,
  });

  return baseList;
};
