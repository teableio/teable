import { useQuery } from '@tanstack/react-query';
import { getSpaceList } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';

export const useSpaceList = () => {
  const { data: spaceList } = useQuery({
    queryKey: ReactQueryKeys.spaceList(),
    queryFn: () => getSpaceList().then((data) => data.data),
  });

  return { spaceList };
};
