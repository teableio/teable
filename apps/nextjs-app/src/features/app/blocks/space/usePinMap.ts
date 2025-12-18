import { useQuery } from '@tanstack/react-query';
import type { IGetPinListVo } from '@teable/openapi';
import { getPinList } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useIsTemplate } from '@teable/sdk/hooks';

export const usePinMap = () => {
  const isTemplate = useIsTemplate();
  const { data: pinListData } = useQuery({
    queryKey: ReactQueryKeys.pinList(),
    queryFn: () => getPinList().then((data) => data.data),
    enabled: !isTemplate,
  });

  return pinListData?.reduce(
    (acc, pin) => {
      acc[pin.id] = pin;
      return acc;
    },
    {} as Record<string, IGetPinListVo[number]>
  );
};
