import { useQuery } from '@tanstack/react-query';
import { getSpaceList } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useMemo } from 'react';
import { usePinMap } from './usePinMap';

export const useSpaceListOrdered = () => {
  const { data: spaceList } = useQuery({
    queryKey: ReactQueryKeys.spaceList(),
    queryFn: getSpaceList,
  });

  const pinMap = usePinMap();

  return useMemo(() => {
    if (!spaceList?.data || !pinMap) {
      return [];
    }
    return [...spaceList.data].sort((a, b) => {
      const aPin = pinMap[a.id];
      const bPin = pinMap[b.id];
      if (!bPin) {
        return -1;
      }
      if (!aPin && bPin) {
        return 1;
      }
      return aPin.order - bPin.order;
    });
  }, [pinMap, spaceList?.data]);
};
