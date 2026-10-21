import { getGoogleSheetPickerConfig, getUserIntegrationToken } from '@teable/openapi';

/**
 * The two prerequisites of opening the Google Picker, fetched together but
 * failed APART: a rejected token request means the stored grant was revoked
 * or can no longer refresh — worth routing to a re-connect — while a rejected
 * config fetch is transient and keeps the healthy integration where a plain
 * retry can succeed (a re-OAuth could not fix it).
 */
export type IPickerPrereqs =
  | { status: 'ok'; accessToken: string; apiKey: string; appId: string }
  | { status: 'tokenFailed'; reason: unknown }
  | { status: 'configFailed'; reason: unknown };

export const fetchPickerPrereqs = async (integrationId: string): Promise<IPickerPrereqs> => {
  const [configResult, tokenResult] = await Promise.allSettled([
    getGoogleSheetPickerConfig(),
    getUserIntegrationToken(integrationId),
  ]);
  if (tokenResult.status === 'rejected') {
    return { status: 'tokenFailed', reason: tokenResult.reason };
  }
  if (configResult.status === 'rejected') {
    return { status: 'configFailed', reason: configResult.reason };
  }
  return {
    status: 'ok',
    accessToken: tokenResult.value.data.accessToken,
    apiKey: configResult.value.data.apiKey,
    appId: configResult.value.data.appId,
  };
};
