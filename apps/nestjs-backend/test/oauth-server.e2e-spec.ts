/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import { HttpError } from '@teable/core';
import {
  GET_TABLE_LIST,
  deleteBase,
  generateOAuthSecret,
  oauthCreate,
  oauthDelete,
  revokeAccess,
  urlBuilder,
} from '@teable/openapi';
import type { ITableListVo, OAuthCreateVo } from '@teable/openapi';
import type { AxiosInstance, AxiosResponse } from 'axios';
import axiosInstance from 'axios';
import { omit } from 'lodash';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { getError } from './utils/get-error';
import { createBase, initApp } from './utils/init-app';

const oauthData = {
  name: 'test',
  redirectUris: ['http://localhost:3000/callback'],
  scopes: ['user|email_read'],
  homepage: 'http://localhost:3000',
};

const gerAuthorize = async (axios: AxiosInstance, oauth: OAuthCreateVo, state?: string) => {
  const res = await axios.get(
    `/oauth/authorize?response_type=code&client_id=${oauth.clientId}&scope=${oauth.scopes?.join(' ')}${state ? '&state=' + state : ''}`,
    {
      maxRedirects: 0,
    }
  );
  const url = new URL(res.headers.location);
  return {
    transactionID: url.searchParams.get('transaction_id') as string | null,
    code: url.searchParams.get('code') as string | null,
  };
};

const decision = async (axios: AxiosInstance, transactionID: string, cancel?: string) => {
  return axios.post(
    `/oauth/decision`,
    {
      transaction_id: transactionID,
      cancel,
    },
    {
      maxRedirects: 0,
      headers: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  );
};

describe('OpenAPI OAuthController (e2e)', () => {
  let app: INestApplication;
  let oauth: OAuthCreateVo;
  let axios: AxiosInstance;
  let anonymousAxios: AxiosInstance;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    axios = axiosInstance.create({
      baseURL: `${appCtx.appUrl}/api`,
      headers: {
        cookie: appCtx.cookie,
      },
      validateStatus: function (status) {
        return (status >= 200 && status < 209) || status === 302;
      },
    });

    anonymousAxios = axiosInstance.create({
      baseURL: `${appCtx.appUrl}/api`,
    });

    const interceptorsRes = (response: AxiosResponse<any, any>) => {
      return response;
    };
    const interceptorsError = (error: any) => {
      const { data, status } = error?.response || {};
      throw new HttpError(data || error?.message || 'no response from server', status || 500);
    };

    axios.interceptors.response.use(interceptorsRes, interceptorsError);
    anonymousAxios.interceptors.response.use(interceptorsRes, interceptorsError);
  });

  beforeEach(async () => {
    const res = await oauthCreate(oauthData);
    oauth = res.data;
  });

  afterEach(async () => {
    await oauthDelete(oauth.clientId);
  });

  afterAll(async () => {
    await app.close();
  });

  it('/api/oauth/authorize (GET)', async () => {
    const res = await axios.get(
      `/oauth/authorize?response_type=code&client_id=${oauth.clientId}&redirect_uri=${oauth.redirectUris[0]}&scope=${oauth.scopes?.join(' ')}`,
      { maxRedirects: 0 }
    );
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain(`/oauth/decision?transaction_id=`);
  });

  it('/api/oauth/authorize (GET) - redirect_uri invalid', async () => {
    const error = await getError(() =>
      axios.get(
        `/oauth/authorize?response_type=code&client_id=${oauth.clientId}&redirect_uri=http://localhost:3000/callback-invalid&scope=user|email_read`,
        { maxRedirects: 0 }
      )
    );
    expect(error?.status).toBe(400);
  });

  it('/api/oauth/authorize (GET) - scope invalid', async () => {
    const error = await getError(() =>
      axios.get(
        `/oauth/authorize?response_type=code&client_id=${oauth.clientId}&redirect_uri=${oauth.redirectUris[0]}&scope=dddd`,
        { maxRedirects: 0 }
      )
    );
    expect(error?.status).toBe(400);
  });

  it('/api/oauth/decision (POST)', async () => {
    const { transactionID } = await gerAuthorize(axios, oauth);
    const ensure = await decision(axios, transactionID!);
    expect(ensure.status).toBe(302);
    expect(ensure.headers.location).toContain(`${oauth.redirectUris[0]}?code=`);
    // Trust Authorized
    const { code } = await gerAuthorize(axios, oauth);
    expect(code).not.toBeNull();
  });

  it('/api/oauth/decision (POST) - state', async () => {
    const { transactionID } = await gerAuthorize(axios, oauth, '123456');
    const ensure = await decision(axios, transactionID!);
    expect(ensure.status).toBe(302);
    expect(ensure.headers.location).toContain(`${oauth.redirectUris[0]}?code=`);
    const url = new URL(ensure.headers.location);
    const state = url.searchParams.get('state');
    expect(state).toBe('123456');
  });

  it('/api/oauth/decision (POST) - Deny', async () => {
    const { transactionID } = await gerAuthorize(axios, oauth);
    const decisionRes = await decision(axios, transactionID!, 'Deny');
    expect(decisionRes.status).toBe(302);
    expect(decisionRes.headers.location).toContain(`${oauth.redirectUris[0]}?error=access_denied`);
  });

  it('/api/oauth/decision (POST) - transaction_id invalid', async () => {
    const error = await getError(() => decision(axios, 'invalid'));
    expect(error?.status).toBe(400);
  });

  it('/api/oauth/decision/:transactionId (GET)', async () => {
    const { transactionID } = await gerAuthorize(axios, oauth);

    const res = await axios.get(`/oauth/decision/${transactionID}`);
    expect(res.status).toBe(200);
    expect(res.data).toEqual(omit(oauthData, 'redirectUris'));
  });

  it('/api/oauth/decision/:transactionId (GET) - transaction_id invalid', async () => {
    const error = await getError(() => axios.get(`/oauth/decision/invalid`));
    expect(error?.status).toBe(400);
  });

  it('/api/oauth/decision/:transactionId (GET) - transaction_id invalid', async () => {
    const error = await getError(() => axios.get(`/oauth/decision/invalid`));
    expect(error?.status).toBe(400);
  });

  it('/api/oauth/decision/:transactionId (GET) - user mismatch', async () => {
    // Mismatch between user and transaction_id
    const user2Request = await createNewUserAxios({
      email: 'oauth1@example.com',
      password: '12345678',
    });
    const { transactionID } = await gerAuthorize(axios, oauth);
    const error = await getError(() => user2Request.get(`/oauth/decision/${transactionID}`));
    expect(error?.status).toBe(400);
    expect(error?.message).toBe('Invalid user');
  });

  it('/api/oauth/access_token (POST)', async () => {
    const { transactionID } = await gerAuthorize(axios, oauth);

    const res = await decision(axios, transactionID!);

    const url = new URL(res.headers.location);
    const code = url.searchParams.get('code');
    const secret = await generateOAuthSecret(oauth.clientId);

    const tokenRes = await anonymousAxios.post(
      `/oauth/access_token`,
      {
        grant_type: 'authorization_code',
        code,
        client_id: oauth.clientId,
        client_secret: secret.data.secret,
        redirect_uri: oauth.redirectUris[0],
      },
      {
        maxRedirects: 0,
        headers: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );
    expect(tokenRes.status).toBe(201);
    expect(tokenRes.data).toEqual({
      token_type: 'Bearer',
      scopes: oauth.scopes,
      access_token: expect.any(String),
      refresh_token: expect.any(String),
      expires_in: expect.any(Number),
      refresh_expires_in: expect.any(Number),
    });

    const userInfo = await anonymousAxios.get(`/auth/user`, {
      headers: {
        Authorization: `${tokenRes.data.token_type} ${tokenRes.data.access_token}`,
      },
    });
    expect(userInfo.data.email).toEqual(globalThis.testConfig.email);
  });

  it('/api/oauth/access_token (POST) - has decision', async () => {
    const { transactionID } = await gerAuthorize(axios, oauth);
    await decision(axios, transactionID!);
    const { code } = await gerAuthorize(axios, oauth);
    const secret = await generateOAuthSecret(oauth.clientId);

    const tokenRes = await anonymousAxios.post(
      `/oauth/access_token`,
      {
        grant_type: 'authorization_code',
        code,
        client_id: oauth.clientId,
        client_secret: secret.data.secret,
      },
      {
        maxRedirects: 0,
        headers: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );
    expect(tokenRes.status).toBe(201);
    expect(tokenRes.data).toEqual({
      token_type: 'Bearer',
      scopes: oauth.scopes,
      access_token: expect.any(String),
      refresh_token: expect.any(String),
      expires_in: expect.any(Number),
      refresh_expires_in: expect.any(Number),
    });
  });

  it('/api/oauth/access_token (POST) - scope [no email]', async () => {
    const oauthRes = await oauthCreate({
      ...oauthData,
      scopes: ['table|read'],
    });
    const { transactionID } = await gerAuthorize(axios, oauthRes.data);

    const res = await decision(axios, transactionID!);
    const url = new URL(res.headers.location);
    const code = url.searchParams.get('code');
    const secret = await generateOAuthSecret(oauthRes.data.clientId);

    const tokenRes = await anonymousAxios.post(
      `/oauth/access_token`,
      {
        grant_type: 'authorization_code',
        code,
        client_id: oauthRes.data.clientId,
        client_secret: secret.data.secret,
        redirect_uri: oauthRes.data.redirectUris[0],
      },
      {
        maxRedirects: 0,
        headers: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );
    const userInfo = await anonymousAxios.get(`/auth/user`, {
      headers: {
        Authorization: `${tokenRes.data.token_type} ${tokenRes.data.access_token}`,
      },
    });
    expect(userInfo.data.email).toBeUndefined();
    const base = await createBase({
      spaceId: globalThis.testConfig.spaceId,
      name: 'oauth-server-test',
    });
    const tableListRes = await anonymousAxios.get<ITableListVo>(
      urlBuilder(GET_TABLE_LIST, { baseId: base.id }),
      {
        headers: {
          Authorization: `${tokenRes.data.token_type} ${tokenRes.data.access_token}`,
        },
      }
    );
    expect(tableListRes.status).toBe(200);
    expect(tableListRes.data).toEqual(expect.any(Array));

    // no scope table|create
    const error = await getError(() =>
      anonymousAxios.post(
        `/base/${base.id}/table`,
        {},
        {
          headers: {
            Authorization: `${tokenRes.data.token_type} ${tokenRes.data.access_token}`,
          },
        }
      )
    );
    await deleteBase(base.id);
    expect(error?.status).toBe(403);
  });

  it('/api/oauth/access_token (POST) - refresh token', async () => {
    const { transactionID } = await gerAuthorize(axios, oauth);

    const res = await decision(axios, transactionID!);

    const url = new URL(res.headers.location);
    const code = url.searchParams.get('code');
    const secret = await generateOAuthSecret(oauth.clientId);

    const tokenRes = await anonymousAxios.post(
      `/oauth/access_token`,
      {
        grant_type: 'authorization_code',
        code,
        client_id: oauth.clientId,
        client_secret: secret.data.secret,
        redirect_uri: oauth.redirectUris[0],
      },
      {
        maxRedirects: 0,
        headers: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    const refreshTokenRes = await anonymousAxios.post(
      `/oauth/access_token`,
      {
        grant_type: 'refresh_token',
        refresh_token: tokenRes.data.refresh_token,
        client_id: oauth.clientId,
        client_secret: secret.data.secret,
      },
      {
        maxRedirects: 0,
        headers: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );
    expect(refreshTokenRes.status).toBe(201);
    expect(refreshTokenRes.data).toEqual({
      token_type: 'Bearer',
      scopes: oauth.scopes,
      access_token: expect.any(String),
      refresh_token: expect.any(String),
      expires_in: expect.any(Number),
      refresh_expires_in: expect.any(Number),
    });

    // previous refresh token should be invalid
    const error = await getError(() =>
      anonymousAxios.post(
        `/oauth/access_token`,
        {
          grant_type: 'refresh_token',
          refresh_token: tokenRes.data.refresh_token,
          client_id: oauth.clientId,
          client_secret: secret.data.secret,
        },
        {
          maxRedirects: 0,
          headers: {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      )
    );
    expect(error?.status).toBe(401);
  });

  describe('revoke access', () => {
    let accessToken: string;

    beforeEach(async () => {
      const { transactionID } = await gerAuthorize(axios, oauth);

      const res = await decision(axios, transactionID!);

      const url = new URL(res.headers.location);
      const code = url.searchParams.get('code');
      const secret = await generateOAuthSecret(oauth.clientId);

      const tokenRes = await anonymousAxios.post(
        `/oauth/access_token`,
        {
          grant_type: 'authorization_code',
          code,
          client_id: oauth.clientId,
          client_secret: secret.data.secret,
          redirect_uri: oauth.redirectUris[0],
        },
        {
          maxRedirects: 0,
          headers: {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );
      accessToken = tokenRes.data.access_token;
    });

    it('/api/oauth/client/:clientId/revoke-access (GET)', async () => {
      const revokeRes = await anonymousAxios.get(`/oauth/client/${oauth.clientId}/revoke-token`, {
        headers: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Bearer ${accessToken}`,
        },
      });

      expect(revokeRes.status).toBe(200);

      const error = await getError(() =>
        anonymousAxios.get(`/auth/user`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        })
      );
      expect(error?.status).toBe(401);
    });

    it('/api/oauth/client/:clientId/revoke-access (POST)', async () => {
      const revokeRes = await revokeAccess(oauth.clientId);
      expect(revokeRes.status).toBe(200);

      const error = await getError(() =>
        anonymousAxios.get(`/auth/user`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        })
      );
      expect(error?.status).toBe(401);
    });
  });
});
