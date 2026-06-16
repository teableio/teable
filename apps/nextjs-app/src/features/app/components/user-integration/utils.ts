import { UserIntegrationProvider } from '@teable/openapi';

export const openConnectIntegration = (
  provider: UserIntegrationProvider,
  queryParams?: Record<string, string>
) => {
  const queryString = new URLSearchParams({
    ...queryParams,
    callBackType: 'page',
  }).toString();
  switch (provider) {
    case UserIntegrationProvider.Slack:
    case UserIntegrationProvider.Gmail:
    case UserIntegrationProvider.Outlook:
    case UserIntegrationProvider.Airtable:
      return window.open(`/api/user-integrations/authorize/${provider}?${queryString}`, '_blank');
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
};

export const getUserIntegrationName = (provider: UserIntegrationProvider) => {
  switch (provider) {
    case UserIntegrationProvider.Slack:
      return 'Slack';
    case UserIntegrationProvider.Gmail:
      return 'Gmail';
    case UserIntegrationProvider.Outlook:
      return 'Outlook';
    case UserIntegrationProvider.Airtable:
      return 'Airtable';
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
};
