import { UserIntegrationProvider } from '@teable/openapi';

export const openConnectIntegration = (
  provider: UserIntegrationProvider,
  queryParams?: Record<string, string>
) => {
  const queryString = new URLSearchParams({
    ...queryParams,
    callBackType: 'page',
  }).toString();
  // eslint-disable-next-line sonarjs/no-small-switch
  switch (provider) {
    case UserIntegrationProvider.Slack:
      return window.open(
        `/api/user-integrations/authorize/${UserIntegrationProvider.Slack}?${queryString}`,
        '_blank'
      );
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
};

export const getUserIntegrationName = (provider: UserIntegrationProvider) => {
  // eslint-disable-next-line sonarjs/no-small-switch
  switch (provider) {
    case UserIntegrationProvider.Slack:
      return 'Slack';
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
};
