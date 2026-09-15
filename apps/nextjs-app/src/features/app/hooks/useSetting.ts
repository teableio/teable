import { useQuery } from '@tanstack/react-query';
import { getPublicSetting, UserIntegrationProvider } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useSession } from '@teable/sdk/hooks';
import { useMemo } from 'react';

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

/** OAuth providers this deployment can connect, in enum order; empty until the setting loads. */
export const useAvailableIntegrationProviders = (): UserIntegrationProvider[] => {
  const { data: publicSetting } = usePublicSettingQuery();
  const available = publicSetting?.availableIntegrationProviders;
  return useMemo(
    () => Object.values(UserIntegrationProvider).filter((p) => available?.includes(p)),
    [available]
  );
};
