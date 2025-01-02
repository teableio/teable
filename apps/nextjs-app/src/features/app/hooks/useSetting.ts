import { useQuery } from '@tanstack/react-query';
import { getPublicSetting } from '@teable/openapi';
import { useSession } from '@teable/sdk/hooks';

export const useSetting = () => {
  const { user } = useSession();
  const { data: setting, isLoading } = useQuery({
    queryKey: ['public-setting'],
    queryFn: () => getPublicSetting().then(({ data }) => data),
  });

  const {
    disallowSignUp = false,
    disallowSpaceCreation = false,
    disallowSpaceInvitation = false,
  } = setting ?? {};

  return {
    disallowSignUp,
    disallowSpaceCreation: !user.isAdmin && (isLoading || disallowSpaceCreation),
    disallowSpaceInvitation: !user.isAdmin && (isLoading || disallowSpaceInvitation),
  };
};
