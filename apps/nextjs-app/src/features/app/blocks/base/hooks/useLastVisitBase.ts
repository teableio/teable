import { useQuery } from '@tanstack/react-query';

import { getUserLastVisitListBase } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { keyBy } from 'lodash';
import { useMemo } from 'react';

export const useLastVisitBase = () => {
  const { data: recentlyBase } = useQuery({
    queryKey: ReactQueryKeys.recentlyBase(),
    queryFn: () => getUserLastVisitListBase().then((res) => res.data),
  });

  return useMemo(() => {
    if (!recentlyBase) {
      return {
        total: 0,
        list: [],
      };
    }
    const { list: resourceList, total } = recentlyBase;

    const list = resourceList.map((item) => {
      const base = item.resource;
      return {
        ...base,
        lastVisitTime: item.lastVisitTime,
      };
    });

    const map = keyBy(list, 'id');

    return {
      total,
      list,
      map,
    };
  }, [recentlyBase]);
};
