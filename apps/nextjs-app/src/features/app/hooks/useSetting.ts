import { useQuery } from '@tanstack/react-query';
import { getSetting } from '@teable/openapi';
import { useSession } from '@teable/sdk/hooks';

export const useSetting = () => {
  const { user } = useSession();
  const { data: setting, isLoading } = useQuery({
    queryKey: ['setting'],
    queryFn: () => getSetting().then(({ data }) => data),
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
