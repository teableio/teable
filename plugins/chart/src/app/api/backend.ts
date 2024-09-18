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

export const baseURL = process.env.PLUGIN_TEABLE_BACKEND_BASE_URL || 'http://127.0.0.1:3000/api';
export const secret =
  process.env.PLUGIN_CHART_SECRET || process.env.SECRET_KEY || 'defaultSecretKey';

export type IFetchResponse<T> =
  | { success: false; error: { status: number; message: string } }
  | { success: true; data: T };

export const fetchAuthCode = async (
  pluginId: string,
  baseId: string,
  cookie: string
): Promise<IFetchResponse<string>> => {
  const res = await fetch(
    `${baseURL}${urlBuilder(PLUGIN_GET_AUTH_CODE, {
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

export const fetchToken = async (
  pluginId: string,
  baseId: string,
  authCode: string
): Promise<IFetchResponse<IPluginGetTokenVo>> => {
  const res = await fetch(
    `${baseURL}${urlBuilder(PLUGIN_GET_TOKEN, {
      pluginId,
    })}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        baseId,
        scopes: ['base|query_data'],
        secret,
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

export const fetchRefreshToken = async (
  pluginId: string,
  refreshToken: string
): Promise<IFetchResponse<IPluginRefreshTokenVo>> => {
  const res = await fetch(
    `${baseURL}${urlBuilder(PLUGIN_REFRESH_TOKEN, {
      pluginId,
    })}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        refreshToken,
        secret,
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

export const fetchBasePermissions = async (
  baseId: string,
  cookie: string
): Promise<IFetchResponse<IGetBasePermissionVo>> => {
  const res = await fetch(
    `${baseURL}${urlBuilder(GET_BASE_PERMISSION, {
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
