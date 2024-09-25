import type { Action } from '@teable/core';
import type {
  IGetBasePermissionVo,
  IPluginGetTokenVo,
  IPluginRefreshTokenVo,
} from '@teable/openapi';
import {
  GET_BASE_PERMISSION,
  PLUGIN_GET_AUTH_CODE,
  PLUGIN_GET_TOKEN,
  PLUGIN_REFRESH_TOKEN,
  urlBuilder,
} from '@teable/openapi';

export type IFetchResponse<T> =
  | { success: false; error: { status: number; message: string } }
  | { success: true; data: T };

export class AuthRequest {
  baseUrl!: string;
  secret!: string;
  tokenStorage: Record<
    string,
    {
      accessToken: string;
      refreshToken: string;
      refreshExpiresTime: number;
      expiresTime: number;
    } | null
  > = {};
  tokenFetchPromises: Record<string, Promise<IFetchResponse<{ accessToken: string }>> | null> = {};

  init = (baseUrl: string, secret: string) => {
    this.baseUrl = baseUrl;
    this.secret = secret;
  };

  getToken = async (
    pluginId: string,
    baseId: string,
    cookie: string,
    scopes: Action[]
  ): Promise<IFetchResponse<{ accessToken: string }>> => {
    const key = `${baseId}-${pluginId}`;
    // if there is a token request in progress, wait for it to finish
    if (this.tokenFetchPromises[key]) {
      console.log('waiting for token request to finish');
      const res = await (this.tokenFetchPromises[key] as Promise<
        IFetchResponse<{ accessToken: string }>
      >);
      this.tokenFetchPromises[key] = null;
      return res;
    }

    // if the token is expired, start a new request to get a new token and store it
    this.tokenFetchPromises[key] = this.innerGetToken(pluginId, baseId, cookie, scopes);

    const res = await (this.tokenFetchPromises[key] as Promise<
      IFetchResponse<{ accessToken: string }>
    >);
    this.tokenFetchPromises[key] = null;
    return res;
  };

  innerGetToken = async (
    pluginId: string,
    baseId: string,
    cookie: string,
    scopes: Action[]
  ): Promise<IFetchResponse<{ accessToken: string }>> => {
    const storage = this.tokenStorage[`${baseId}-${pluginId}`];
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
      const token = await this.fetchRefreshToken(pluginId, storage.refreshToken);
      console.log('refresh token is still valid');
      if (!token.success) {
        return token;
      }
      this.tokenStorage[`${baseId}-${pluginId}`] = {
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

    const authCode = await this.fetchAuthCode(pluginId, baseId, cookie);
    if (!authCode.success) {
      return authCode;
    }
    const token = await this.fetchToken(pluginId, baseId, authCode.data, scopes);
    if (!token.success) {
      return token;
    }
    console.log('refresh token expired, get new token');
    this.tokenStorage[`${baseId}-${pluginId}`] = {
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

  fetchAuthCode = async (
    pluginId: string,
    baseId: string,
    cookie: string
  ): Promise<IFetchResponse<string>> => {
    const res = await fetch(
      `${this.baseUrl}${urlBuilder(PLUGIN_GET_AUTH_CODE, {
        pluginId,
      })}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie,
        },
        body: JSON.stringify({
          baseId,
        }),
      }
    );
    if (res.status < 200 || res.status > 300) {
      const error = await res.text();
      console.error('fetch auth code failed', error);
      return {
        success: false,
        error: {
          message: error,
          status: res.status,
        },
      };
    }
    return {
      success: true,
      data: await res.text(),
    };
  };

  fetchToken = async (
    pluginId: string,
    baseId: string,
    authCode: string,
    scopes: Action[]
  ): Promise<IFetchResponse<IPluginGetTokenVo>> => {
    const res = await fetch(
      `${this.baseUrl}${urlBuilder(PLUGIN_GET_TOKEN, {
        pluginId,
      })}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          baseId,
          scopes,
          secret: this.secret,
          authCode,
        }),
      }
    );
    if (res.status < 200 || res.status > 300) {
      const error = await res.text();
      console.error('fetch token failed', error);
      return {
        success: false,
        error: {
          message: error,
          status: res.status,
        },
      };
    }
    const data: IPluginGetTokenVo = await res.json();
    return {
      success: true,
      data,
    };
  };

  fetchRefreshToken = async (
    pluginId: string,
    refreshToken: string
  ): Promise<IFetchResponse<IPluginRefreshTokenVo>> => {
    const res = await fetch(
      `${this.baseUrl}${urlBuilder(PLUGIN_REFRESH_TOKEN, {
        pluginId,
      })}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          refreshToken,
          secret: this.secret,
        }),
      }
    );
    if (res.status < 200 || res.status > 300) {
      const error = await res.text();
      console.error('refresh token failed', error);
      return {
        success: false,
        error: {
          message: error,
          status: res.status,
        },
      };
    }
    const data: IPluginRefreshTokenVo = await res.json();
    return {
      success: true,
      data,
    };
  };

  fetchBasePermissions = async (
    baseId: string,
    cookie: string
  ): Promise<IFetchResponse<IGetBasePermissionVo>> => {
    const res = await fetch(
      `${this.baseUrl}${urlBuilder(GET_BASE_PERMISSION, {
        baseId,
      })}`,
      {
        headers: {
          cookie,
        },
      }
    );
    if (res.status < 200 || res.status > 300) {
      const error = await res.text();
      console.error('fetch base permissions failed', error);
      return {
        success: false,
        error: {
          message: error,
          status: res.status,
        },
      };
    }
    const data: IGetBasePermissionVo = await res.json();
    return {
      success: true,
      data,
    };
  };
}

// export const baseURL = process.env.PLUGIN_TEABLE_BACKEND_BASE_URL || 'http://127.0.0.1:3000/api';
// export const secret =
//   process.env.PLUGIN_CHART_SECRET || process.env.SECRET_KEY || 'defaultSecretKey';
