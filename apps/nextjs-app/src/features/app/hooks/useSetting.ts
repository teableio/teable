import { useQuery } from '@tanstack/react-query';
import { getPublicSetting } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useSession } from '@teable/sdk/hooks';

export const useSetting = () => {
  const { user } = useSession();
  const { data: setting, isLoading } = useQuery({
    queryKey: ReactQueryKeys.getPublicSetting(),
    queryFn: () => getPublicSetting().then(({ data }) => data),
  });

  const {
    disallowSignUp = false,
    disallowSpaceCreation = false,
    disallowSpaceInvitation = false,
    disallowDashboard = false,
    appGenerationEnabled = false,
    createdTime,
    enableCreditReward = false,
  } = setting ?? {};

  return {
    disallowSignUp,
    disallowSpaceCreation: !user.isAdmin && (isLoading || disallowSpaceCreation),
    disallowSpaceInvitation: !user.isAdmin && (isLoading || disallowSpaceInvitation),
    disallowDashboard,
    appGenerationEnabled,
    createdTime,
    enableCreditReward,
  };
};

export const usePublicSettingQuery = () => {
  return useQuery({
    queryKey: ReactQueryKeys.getPublicSetting(),
    queryFn: () => getPublicSetting().then(({ data }) => data),
  });
};
