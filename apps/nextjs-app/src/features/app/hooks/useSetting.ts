import { useQuery } from '@tanstack/react-query';
import { getSetting } from '@teable/openapi';
import { useIsEE } from './useIsEE';

export const useSetting = () => {
  const isEE = useIsEE();
  const { data: setting, isLoading } = useQuery({
    queryKey: ['setting'],
    queryFn: () => getSetting().then(({ data }) => data),
    enabled: isEE,
  });

  const {
    disallowSignUp = false,
    disallowResetPassword = false,
    disallowSpaceCreation = false,
  } = setting ?? {};

  return {
    disallowSignUp,
    disallowResetPassword: (isEE && isLoading) || disallowResetPassword,
    disallowSpaceCreation: (isEE && isLoading) || disallowSpaceCreation,
  };
};
