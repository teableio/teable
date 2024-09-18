import { fetchAuthCode, fetchRefreshToken, fetchToken, type IFetchResponse } from '../../backend';

const tokenStorage: Record<
  string,
  {
    accessToken: string;
    refreshToken: string;
    refreshExpiresTime: number;
    expiresTime: number;
  } | null
> = {};
const tokenFetchPromises: Record<string, Promise<IFetchResponse<{ accessToken: string }>> | null> =
  {};

const innerGetToken = async (
  pluginId: string,
  baseId: string,
  cookie: string
): Promise<IFetchResponse<{ accessToken: string }>> => {
  const storage = tokenStorage[`${baseId}-${pluginId}`];
  // Check if the access token is still valid,
  if (storage && storage.expiresTime > Date.now()) {
    console.log('access token is still valid');
    return {
      success: true,
      data: { accessToken: storage.accessToken },
    };
  }
  // Check if the refresh token is still valid,
  if (storage && storage.refreshExpiresTime > Date.now()) {
    const token = await fetchRefreshToken(pluginId, storage.refreshToken);
    console.log('refresh token is still valid');
    if (!token.success) {
      return token;
    }
    tokenStorage[`${baseId}-${pluginId}`] = {
      accessToken: token.data.accessToken,
      refreshToken: token.data.refreshToken,
      // Subtract 1 minute from the expiration time to ensure the token is refreshed before it expires
      expiresTime: Date.now() + token.data.expiresIn * 1000 - 1 * 60 * 1000,
      // Subtract 24 hours from the expiration time to ensure the token is refreshed before it expires
      refreshExpiresTime: Date.now() + token.data.refreshExpiresIn * 1000 - 24 * 60 * 60 * 1000,
    };
    return {
      success: true,
      data: { accessToken: token.data.accessToken },
    };
  }

  const authCode = await fetchAuthCode(pluginId, baseId, cookie);
  if (!authCode.success) {
    return authCode;
  }
  const token = await fetchToken(pluginId, baseId, authCode.data);
  if (!token.success) {
    return token;
  }
  console.log('refresh token expired, get new token');
  tokenStorage[`${baseId}-${pluginId}`] = {
    accessToken: token.data.accessToken,
    refreshToken: token.data.refreshToken,
    // Subtract 1 minute from the expiration time to ensure the token is refreshed before it expires
    expiresTime: Date.now() + token.data.expiresIn * 1000 - 1 * 60 * 1000,
    // Subtract 24 hours from the expiration time to ensure the token is refreshed before it expires
    refreshExpiresTime: Date.now() + token.data.refreshExpiresIn * 1000 - 24 * 60 * 60 * 1000,
  };
  return {
    success: true,
    data: { accessToken: token.data.accessToken },
  };
};

export const getToken = async (
  pluginId: string,
  baseId: string,
  cookie: string
): Promise<IFetchResponse<{ accessToken: string }>> => {
  const key = `${baseId}-${pluginId}`;

  // if there is a token request in progress, wait for it to finish
  if (tokenFetchPromises[key]) {
    console.log('waiting for token request to finish');
    const res = await (tokenFetchPromises[key] as Promise<IFetchResponse<{ accessToken: string }>>);
    tokenFetchPromises[key] = null;
    return res;
  }

  // if the token is expired, start a new request to get a new token and store it
  tokenFetchPromises[key] = innerGetToken(pluginId, baseId, cookie);

  const res = await (tokenFetchPromises[key] as Promise<IFetchResponse<{ accessToken: string }>>);
  tokenFetchPromises[key] = null;
  return res;
};
