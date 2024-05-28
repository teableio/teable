import { useQuery } from '@tanstack/react-query';
import type { GetPinListVo } from '@teable/openapi';
import { getPinList } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';

export const usePinMap = () => {
  const { data: pinListData } = useQuery({
    queryKey: ReactQueryKeys.pinList(),
    queryFn: getPinList,
  });

  return pinListData?.data.reduce(
    (acc, pin) => {
      acc[pin.id] = pin;
      return acc;
    },
    {} as Record<string, GetPinListVo[number]>
  );
};
