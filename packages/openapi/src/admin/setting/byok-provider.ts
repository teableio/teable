export const BYOK_PROVIDER_NAME_PREFIX = 'byok-';

const reservedAIProviderNames = ['teable'];

export const isReservedAIProviderName = (name: string | undefined | null) => {
  return reservedAIProviderNames.includes(name?.trim().toLowerCase() ?? '');
};
