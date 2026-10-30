import { useQuery } from '@tanstack/react-query';
import { getSpaceList } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';

export const useSpaceList = (enabled = true) => {
  const { data: spaceList, isLoading } = useQuery({
    queryKey: ReactQueryKeys.spaceList(),
    queryFn: () => getSpaceList().then((data) => data.data),
    enabled,
  });

  return { spaceList, isLoading };
};
