import { useQuery } from '@tanstack/react-query';
import { getPublicSetting } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';

export const useDisallowSignUp = () => {
  const { data: setting } = useQuery({
    queryKey: ReactQueryKeys.getPublicSetting(),
    queryFn: () => getPublicSetting().then(({ data }) => data),
  });
  const { disallowSignUp } = setting ?? {};
  return disallowSignUp;
};
