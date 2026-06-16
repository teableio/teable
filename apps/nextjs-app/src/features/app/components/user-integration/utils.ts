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
    case UserIntegrationProvider.Airtable: {
      // Open a centered popup instead of a full new tab for a tidier OAuth flow.
      const width = 600;
      const height = 720;
      const left = window.screenX + Math.max(0, (window.outerWidth - width) / 2);
      const top = window.screenY + Math.max(0, (window.outerHeight - height) / 2);
      return window.open(
        `/api/user-integrations/authorize/${provider}?${queryString}`,
        'teable-oauth',
        `popup=yes,width=${width},height=${height},left=${left},top=${top}`
      );
    }
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
