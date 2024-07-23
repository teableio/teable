import { useQuery } from '@tanstack/react-query';
import { getSpaceList } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useMemo } from 'react';
import { usePinMap } from './usePinMap';

export const useSpaceListOrdered = () => {
  const { data: spaceList } = useQuery({
    queryKey: ReactQueryKeys.spaceList(),
    queryFn: () => getSpaceList().then((data) => data.data),
  });

  const pinMap = usePinMap();

  return useMemo(() => {
    if (!spaceList || !pinMap) {
      return [];
    }
    return [...spaceList].sort((a, b) => {
      const aPin = pinMap[a.id];
      const bPin = pinMap[b.id];
      if (!aPin && !bPin) {
        return 0; // Both a and b do not have a pin, maintain original order
      }
      if (!aPin) {
        return 1; // a does not have a pin, place a after b
      }
      if (!bPin) {
        return -1; // b does not have a pin, place b after a
      }
      return aPin.order - bPin.order;
    });
  }, [pinMap, spaceList]);
};
