/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable sonarjs/no-duplicate-string */
import crypto from 'crypto';
import type { INestApplication } from '@nestjs/common';
import { HttpError } from '@teable/core';
import {
  CREATE_BASE,
  CREATE_SPACE,
  CREATE_TABLE,
  GET_TABLE_LIST,
  GET_TRASH_ITEMS,
  PERMANENT_DELETE_BASE,
  PERMANENT_DELETE_SPACE,
  REVOKE_TOKEN,
  ResourceType,
  generateOAuthSecret,
  oauthCreate,
  oauthDelete,
  revokeAccess,
  urlBuilder,
} from '@teable/openapi';
import type {
  ICreateBaseVo,
  ICreateSpaceVo,
  IGetBaseAllVo,
  ITableListVo,
  ITableVo,
  ITrashVo,
  OAuthCreateVo,
} from '@teable/openapi';
import type { AxiosInstance, AxiosResponse } from 'axios';
import axiosInstance from 'axios';
import { omit } from 'lodash';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { getError } from './utils/get-error';
import { initApp } from './utils/init-app';

const oauthData = {
  name: 'test',
  redirectUris: ['http://localhost:3000/callback'],
  scopes: ['user|email_read'],
  homepage: 'http://localhost:3000',
};

const getAuthorize = async (axios: AxiosInstance, oauth: OAuthCreateVo, state?: string) => {
  const res = await axios.get(
    `/oauth/authorize?response_type=code&client_id=${oauth.clientId}&scope=${oauth.scopes?.join(' ')}${state ? '&state=' + state : ''}`,
    {
      maxRedirects: 0,
    }
  );

  const url = new URL(res.headers.location, oauth.homepage);
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
const testEmail = 'oauth-server@example.com';

describe('OpenAPI OAuthController (e2e)', () => {
  let app: INestApplication;
  let oauth: OAuthCreateVo;
  let axios: AxiosInstance;
  let spaceId: string;
  let baseId: string;
  let anonymousAxios: AxiosInstance;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    const newUserAxios = await createNewUserAxios({
      email: testEmail,
      password: '12345678',
    });
    axios = axiosInstance.create({
      baseURL: `${appCtx.appUrl}/api`,
      headers: {
        cookie: newUserAxios.defaults.headers.Cookie,
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
    const spaceRes = await axios.post<ICreateSpaceVo>(CREATE_SPACE, {
      name: 'test space',
    });
    spaceId = spaceRes.data.id;

    const baseRes = await axios.post<ICreateBaseVo>(CREATE_BASE, {
      name: 'test base',
      spaceId,
    });
    baseId = baseRes.data.id;
  });

  afterEach(async () => {
    await oauthDelete(oauth.clientId);
    await axios.delete<null>(urlBuilder(PERMANENT_DELETE_BASE, { baseId }));
    await axios.delete<null>(urlBuilder(PERMANENT_DELETE_SPACE, { spaceId }));
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
    expect(error?.status).toBe(401);
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
    const { transactionID } = await getAuthorize(axios, oauth);
    const ensure = await decision(axios, transactionID!);
    expect(ensure.status).toBe(302);
    expect(ensure.headers.location).toContain(`${oauth.redirectUris[0]}?code=`);
    // Trust Authorized
    const { code } = await getAuthorize(axios, oauth);
    expect(code).not.toBeNull();
  });

  it('/api/oauth/decision (POST) - state', async () => {
    const { transactionID } = await getAuthorize(axios, oauth, '123456');
    const ensure = await decision(axios, transactionID!);
    expect(ensure.status).toBe(302);
    expect(ensure.headers.location).toContain(`${oauth.redirectUris[0]}?code=`);
    const url = new URL(ensure.headers.location);
    const state = url.searchParams.get('state');
    expect(state).toBe('123456');
  });

  it('/api/oauth/decision (POST) - Deny', async () => {
    const { transactionID } = await getAuthorize(axios, oauth);
    const decisionRes = await decision(axios, transactionID!, 'Deny');
    expect(decisionRes.status).toBe(302);
    expect(decisionRes.headers.location).toContain(`${oauth.redirectUris[0]}?error=access_denied`);
  });

  it('/api/oauth/decision (POST) - transaction_id invalid', async () => {
    const error = await getError(() => decision(axios, 'invalid'));
    expect(error?.status).toBe(400);
  });

  it('/api/oauth/decision/:transactionId (GET)', async () => {
    const { transactionID } = await getAuthorize(axios, oauth);

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
    const { transactionID } = await getAuthorize(axios, oauth);
    const error = await getError(() => user2Request.get(`/oauth/decision/${transactionID}`));
    expect(error?.status).toBe(400);
    expect(error?.message).toBe('Invalid user');
  });

  it('/api/oauth/access_token (POST)', async () => {
    const { transactionID } = await getAuthorize(axios, oauth);

    const res = await decision(axios, transactionID!);

    const url = new URL(res.headers.location);
    const code = url.searchParams.get('code');
    const secret = await generateOAuthSecret(oauth.clientId);

    const tokenRes = await anonymousAxios.post(
      `/oauth/access_token`,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: code ?? '',
        client_id: oauth.clientId,
        client_secret: secret.data.secret,
        redirect_uri: oauth.redirectUris[0],
      }),
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
    expect(userInfo.data.email).toEqual(testEmail);
  });

  it('/api/oauth/access_token (POST) - has decision', async () => {
    const { transactionID } = await getAuthorize(axios, oauth);
    await decision(axios, transactionID!);
    const { code } = await getAuthorize(axios, oauth);
    const secret = await generateOAuthSecret(oauth.clientId);

    const tokenRes = await anonymousAxios.post(
      `/oauth/access_token`,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: code ?? '',
        client_id: oauth.clientId,
        client_secret: secret.data.secret,
        redirect_uri: oauth.redirectUris[0],
      }),
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
    const { transactionID } = await getAuthorize(axios, oauthRes.data);

    const res = await decision(axios, transactionID!);
    const url = new URL(res.headers.location);
    const code = url.searchParams.get('code');
    const secret = await generateOAuthSecret(oauthRes.data.clientId);

    const tokenRes = await anonymousAxios.post(
      `/oauth/access_token`,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: code ?? '',
        client_id: oauthRes.data.clientId,
        client_secret: secret.data.secret,
        redirect_uri: oauthRes.data.redirectUris[0],
      }),
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
    const tableListRes = await anonymousAxios.get<ITableListVo>(
      urlBuilder(GET_TABLE_LIST, { baseId }),
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
        `/base/${baseId}/table`,
        {},
        {
          headers: {
            Authorization: `${tokenRes.data.token_type} ${tokenRes.data.access_token}`,
          },
        }
      )
    );
    expect(error?.status).toBe(403);
    // base|read_all
    const baseListRes = await anonymousAxios.get<IGetBaseAllVo>(`/base/access/all`, {
      headers: {
        Authorization: `${tokenRes.data.token_type} ${tokenRes.data.access_token}`,
      },
    });
    expect(baseListRes.status).toBe(200);
    expect(baseListRes.data).toEqual(expect.any(Array));
  });

  it('/api/oauth/access_token (POST) - scope [trash]', async () => {
    const oauthRes = await oauthCreate({
      ...oauthData,
      scopes: ['table|trash_read'],
    });
    const { transactionID } = await getAuthorize(axios, oauthRes.data);

    const res = await decision(axios, transactionID!);
    const url = new URL(res.headers.location);
    const code = url.searchParams.get('code');
    const secret = await generateOAuthSecret(oauthRes.data.clientId);

    const tokenRes = await anonymousAxios.post(
      `/oauth/access_token`,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: code ?? '',
        client_id: oauthRes.data.clientId,
        client_secret: secret.data.secret,
        redirect_uri: oauthRes.data.redirectUris[0],
      }),
      {
        maxRedirects: 0,
        headers: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );
    const table = await axios
      .post<ITableVo>(urlBuilder(CREATE_TABLE, { baseId }), {
        name: 'test table',
        records: [
          {
            fields: {},
          },
          {
            fields: {},
          },
          {
            fields: {},
          },
        ],
      })
      .then((res) => res.data);

    const trashItemsRes = await anonymousAxios.get<ITrashVo>(GET_TRASH_ITEMS, {
      params: {
        resourceId: table.id,
        resourceType: ResourceType.Table,
      },
      headers: {
        Authorization: `${tokenRes.data.token_type} ${tokenRes.data.access_token}`,
      },
    });
    expect(trashItemsRes.status).toBe(200);
  });

  it('/api/oauth/access_token (POST) - refresh token', async () => {
    const { transactionID } = await getAuthorize(axios, oauth);

    const res = await decision(axios, transactionID!);

    const url = new URL(res.headers.location);
    const code = url.searchParams.get('code');
    const secret = await generateOAuthSecret(oauth.clientId);

    const tokenRes = await anonymousAxios.post(
      `/oauth/access_token`,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: code ?? '',
        client_id: oauth.clientId,
        client_secret: secret.data.secret,
        redirect_uri: oauth.redirectUris[0],
      }),
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
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: `${tokenRes.data.refresh_token}`,
        client_id: oauth.clientId,
        client_secret: secret.data.secret,
      }),
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
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: `${tokenRes.data.refresh_token}`,
          client_id: oauth.clientId,
          client_secret: secret.data.secret,
        }),
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

  it('/api/oauth/access_token (POST) - confidential refresh token missing client_secret should fail', async () => {
    const { transactionID } = await getAuthorize(axios, oauth);
    const res = await decision(axios, transactionID!);
    const url = new URL(res.headers.location);
    const code = url.searchParams.get('code');
    const secret = await generateOAuthSecret(oauth.clientId);

    const tokenRes = await anonymousAxios.post(
      `/oauth/access_token`,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: code ?? '',
        client_id: oauth.clientId,
        client_secret: secret.data.secret,
        redirect_uri: oauth.redirectUris[0],
      }),
      {
        maxRedirects: 0,
        headers: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );
    expect(tokenRes.status).toBe(201);

    const error = await getError(() =>
      anonymousAxios.post(
        `/oauth/access_token`,
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: `${tokenRes.data.refresh_token}`,
          client_id: oauth.clientId,
        }),
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

  it('/api/oauth/access_token (POST) - confidential refresh token wrong client_secret should fail', async () => {
    const { transactionID } = await getAuthorize(axios, oauth);
    const res = await decision(axios, transactionID!);
    const url = new URL(res.headers.location);
    const code = url.searchParams.get('code');
    const secret = await generateOAuthSecret(oauth.clientId);

    const tokenRes = await anonymousAxios.post(
      `/oauth/access_token`,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: code ?? '',
        client_id: oauth.clientId,
        client_secret: secret.data.secret,
        redirect_uri: oauth.redirectUris[0],
      }),
      {
        maxRedirects: 0,
        headers: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );
    expect(tokenRes.status).toBe(201);

    const error = await getError(() =>
      anonymousAxios.post(
        `/oauth/access_token`,
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: `${tokenRes.data.refresh_token}`,
          client_id: oauth.clientId,
          client_secret: 'invalid-secret',
        }),
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

  it('/api/oauth/access_token (POST) - confidential refresh token with only client_id should fail', async () => {
    const { transactionID } = await getAuthorize(axios, oauth);
    const res = await decision(axios, transactionID!);
    const url = new URL(res.headers.location);
    const code = url.searchParams.get('code');
    const secret = await generateOAuthSecret(oauth.clientId);

    const tokenRes = await anonymousAxios.post(
      `/oauth/access_token`,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: code ?? '',
        client_id: oauth.clientId,
        client_secret: secret.data.secret,
        redirect_uri: oauth.redirectUris[0],
      }),
      {
        maxRedirects: 0,
        headers: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );
    expect(tokenRes.status).toBe(201);

    const error = await getError(() =>
      anonymousAxios.post(
        `/oauth/access_token`,
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: `${tokenRes.data.refresh_token}`,
          client_id: oauth.clientId,
        }),
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

  describe('PKCE flow', () => {
    const generateCodeVerifier = () => {
      return crypto.randomBytes(32).toString('base64url');
    };

    const generateCodeChallenge = (verifier: string) => {
      return crypto.createHash('sha256').update(verifier).digest('base64url');
    };

    const getAuthorizeWithPkce = async (
      ax: AxiosInstance,
      oa: OAuthCreateVo,
      codeChallenge: string,
      codeChallengeMethod = 'S256',
      state?: string
    ) => {
      const res = await ax.get(
        `/oauth/authorize?response_type=code&client_id=${oa.clientId}&scope=${oa.scopes?.join(' ')}&code_challenge=${codeChallenge}&code_challenge_method=${codeChallengeMethod}${state ? '&state=' + state : ''}`,
        { maxRedirects: 0 }
      );

      const url = new URL(res.headers.location, oa.homepage);
      return {
        transactionID: url.searchParams.get('transaction_id') as string | null,
        code: url.searchParams.get('code') as string | null,
      };
    };

    it('/api/oauth/authorize (GET) - with PKCE params', async () => {
      const codeVerifier = generateCodeVerifier();
      const codeChallenge = generateCodeChallenge(codeVerifier);

      const res = await axios.get(
        `/oauth/authorize?response_type=code&client_id=${oauth.clientId}&redirect_uri=${oauth.redirectUris[0]}&scope=${oauth.scopes?.join(' ')}&code_challenge=${codeChallenge}&code_challenge_method=S256`,
        { maxRedirects: 0 }
      );
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain(`/oauth/decision?transaction_id=`);
    });

    it('/api/oauth/authorize (GET) - invalid code_challenge_method', async () => {
      const error = await getError(() =>
        axios.get(
          `/oauth/authorize?response_type=code&client_id=${oauth.clientId}&redirect_uri=${oauth.redirectUris[0]}&scope=${oauth.scopes?.join(' ')}&code_challenge=abc&code_challenge_method=plain`,
          { maxRedirects: 0 }
        )
      );
      expect(error?.status).toBe(400);
    });

    it('/api/oauth/authorize (GET) - code_challenge without method', async () => {
      const codeVerifier = generateCodeVerifier();
      const codeChallenge = generateCodeChallenge(codeVerifier);

      const error = await getError(() =>
        axios.get(
          `/oauth/authorize?response_type=code&client_id=${oauth.clientId}&redirect_uri=${oauth.redirectUris[0]}&scope=${oauth.scopes?.join(' ')}&code_challenge=${codeChallenge}`,
          { maxRedirects: 0 }
        )
      );
      expect(error?.status).toBe(400);
    });

    it('/api/oauth/access_token (POST) - PKCE token exchange', async () => {
      const codeVerifier = generateCodeVerifier();
      const codeChallenge = generateCodeChallenge(codeVerifier);

      const { transactionID } = await getAuthorizeWithPkce(axios, oauth, codeChallenge);
      const res = await decision(axios, transactionID!);

      const url = new URL(res.headers.location);
      const code = url.searchParams.get('code');

      const tokenRes = await anonymousAxios.post(
        `/oauth/access_token`,
        new URLSearchParams({
          grant_type: 'authorization_code',
          code: code ?? '',
          client_id: oauth.clientId,
          code_verifier: codeVerifier,
          redirect_uri: oauth.redirectUris[0],
        }),
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
      expect(userInfo.data.email).toEqual(testEmail);
    });

    it('/api/oauth/access_token (POST) - PKCE with trusted authorization', async () => {
      const codeVerifier1 = generateCodeVerifier();
      const codeChallenge1 = generateCodeChallenge(codeVerifier1);

      // First authorization - user approves
      const { transactionID } = await getAuthorizeWithPkce(
        axios,
        oauth,
        codeChallenge1,
        'S256',
        '123456'
      );
      await decision(axios, transactionID!);

      // Second authorization - should be trusted (immediate)
      const codeVerifier2 = generateCodeVerifier();
      const codeChallenge2 = generateCodeChallenge(codeVerifier2);
      const { code } = await getAuthorizeWithPkce(axios, oauth, codeChallenge2);
      expect(code).not.toBeNull();

      const tokenRes = await anonymousAxios.post(
        `/oauth/access_token`,
        new URLSearchParams({
          grant_type: 'authorization_code',
          code: code ?? '',
          client_id: oauth.clientId,
          code_verifier: codeVerifier2,
          redirect_uri: oauth.redirectUris[0],
        }),
        {
          maxRedirects: 0,
          headers: {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );
      expect(tokenRes.status).toBe(201);
      expect(tokenRes.data.access_token).toBeDefined();
    });

    it('/api/oauth/access_token (POST) - PKCE wrong code_verifier', async () => {
      const codeVerifier = generateCodeVerifier();
      const codeChallenge = generateCodeChallenge(codeVerifier);

      const { transactionID } = await getAuthorizeWithPkce(axios, oauth, codeChallenge);
      const res = await decision(axios, transactionID!);

      const url = new URL(res.headers.location);
      const code = url.searchParams.get('code');

      const wrongVerifier = generateCodeVerifier(); // different verifier

      const error = await getError(() =>
        anonymousAxios.post(
          `/oauth/access_token`,
          new URLSearchParams({
            grant_type: 'authorization_code',
            code: code ?? '',
            client_id: oauth.clientId,
            code_verifier: wrongVerifier,
            redirect_uri: oauth.redirectUris[0],
          }),
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

    it('/api/oauth/access_token (POST) - PKCE missing code_verifier', async () => {
      const codeVerifier = generateCodeVerifier();
      const codeChallenge = generateCodeChallenge(codeVerifier);

      const { transactionID } = await getAuthorizeWithPkce(axios, oauth, codeChallenge);
      const res = await decision(axios, transactionID!);

      const url = new URL(res.headers.location);
      const code = url.searchParams.get('code');

      // Exchange without code_verifier but with client_secret — should fail because code_challenge was set
      const secret = await generateOAuthSecret(oauth.clientId);
      const error = await getError(() =>
        anonymousAxios.post(
          `/oauth/access_token`,
          new URLSearchParams({
            grant_type: 'authorization_code',
            code: code ?? '',
            client_id: oauth.clientId,
            client_secret: secret.data.secret,
            redirect_uri: oauth.redirectUris[0],
          }),
          {
            maxRedirects: 0,
            headers: {
              // eslint-disable-next-line @typescript-eslint/naming-convention
              'Content-Type': 'application/x-www-form-urlencoded',
            },
          }
        )
      );
      expect(error?.status).toBe(400);
    });

    it('/api/oauth/access_token (POST) - PKCE refresh token', async () => {
      const codeVerifier = generateCodeVerifier();
      const codeChallenge = generateCodeChallenge(codeVerifier);

      const { transactionID } = await getAuthorizeWithPkce(axios, oauth, codeChallenge);
      const res = await decision(axios, transactionID!);

      const url = new URL(res.headers.location);
      const code = url.searchParams.get('code');

      const tokenRes = await anonymousAxios.post(
        `/oauth/access_token`,
        new URLSearchParams({
          grant_type: 'authorization_code',
          code: code ?? '',
          client_id: oauth.clientId,
          code_verifier: codeVerifier,
          redirect_uri: oauth.redirectUris[0],
        }),
        {
          maxRedirects: 0,
          headers: {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );
      expect(tokenRes.status).toBe(201);

      // Refresh token using PKCE (no client_secret)
      const refreshTokenRes = await anonymousAxios.post(
        `/oauth/access_token`,
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: tokenRes.data.refresh_token,
          client_id: oauth.clientId,
        }),
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

      // Old refresh token should be invalid
      const error = await getError(() =>
        anonymousAxios.post(
          `/oauth/access_token`,
          new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: tokenRes.data.refresh_token,
            client_id: oauth.clientId,
            code_verifier: codeVerifier,
          }),
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

    it('/api/oauth/access_token (POST) - non-PKCE code with only client_id should fail', async () => {
      const { transactionID } = await getAuthorize(axios, oauth);
      const res = await decision(axios, transactionID!);

      const url = new URL(res.headers.location);
      const code = url.searchParams.get('code');

      const error = await getError(() =>
        anonymousAxios.post(
          `/oauth/access_token`,
          new URLSearchParams({
            grant_type: 'authorization_code',
            code: code ?? '',
            client_id: oauth.clientId,
            redirect_uri: oauth.redirectUris[0],
          }),
          {
            maxRedirects: 0,
            headers: {
              // eslint-disable-next-line @typescript-eslint/naming-convention
              'Content-Type': 'application/x-www-form-urlencoded',
            },
          }
        )
      );
      expect(error?.status).toBe(400);
    });

    it('/api/oauth/access_token (POST) - non-PKCE code with code_verifier should fail', async () => {
      const { transactionID } = await getAuthorize(axios, oauth);
      const res = await decision(axios, transactionID!);

      const url = new URL(res.headers.location);
      const code = url.searchParams.get('code');
      const codeVerifier = generateCodeVerifier();

      const error = await getError(() =>
        anonymousAxios.post(
          `/oauth/access_token`,
          new URLSearchParams({
            grant_type: 'authorization_code',
            code: code ?? '',
            client_id: oauth.clientId,
            code_verifier: codeVerifier,
            redirect_uri: oauth.redirectUris[0],
          }),
          {
            maxRedirects: 0,
            headers: {
              // eslint-disable-next-line @typescript-eslint/naming-convention
              'Content-Type': 'application/x-www-form-urlencoded',
            },
          }
        )
      );
      expect(error?.status).toBe(400);
    });

    it('/api/oauth/access_token (POST) - PKCE revoke access', async () => {
      const codeVerifier = generateCodeVerifier();
      const codeChallenge = generateCodeChallenge(codeVerifier);

      const { transactionID } = await getAuthorizeWithPkce(axios, oauth, codeChallenge);
      const res = await decision(axios, transactionID!);

      const url = new URL(res.headers.location);
      const code = url.searchParams.get('code');

      const tokenRes = await anonymousAxios.post(
        `/oauth/access_token`,
        new URLSearchParams({
          grant_type: 'authorization_code',
          code: code ?? '',
          client_id: oauth.clientId,
          code_verifier: codeVerifier,
          redirect_uri: oauth.redirectUris[0],
        }),
        {
          maxRedirects: 0,
          headers: {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      const revokeRes = await anonymousAxios.get(`/oauth/client/${oauth.clientId}/revoke-token`, {
        headers: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Bearer ${tokenRes.data.access_token}`,
        },
      });
      expect(revokeRes.status).toBe(200);

      const error = await getError(() =>
        anonymousAxios.get(`/auth/user`, {
          headers: {
            Authorization: `Bearer ${tokenRes.data.access_token}`,
          },
        })
      );
      expect(error?.status).toBe(401);
    });
  });

  describe('revoke access', () => {
    let accessToken: string;

    beforeEach(async () => {
      const { transactionID } = await getAuthorize(axios, oauth);

      const res = await decision(axios, transactionID!);

      const url = new URL(res.headers.location);
      const code = url.searchParams.get('code');
      const secret = await generateOAuthSecret(oauth.clientId);

      const tokenRes = await anonymousAxios.post(
        `/oauth/access_token`,
        new URLSearchParams({
          grant_type: 'authorization_code',
          code: code ?? '',
          client_id: oauth.clientId,
          client_secret: secret.data.secret,
          redirect_uri: oauth.redirectUris[0],
        }),
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

    it('/api/oauth/client/:clientId/revoke-token (POST)', async () => {
      const revokeRes = await axios.post<void>(
        urlBuilder(REVOKE_TOKEN, { clientId: oauth.clientId })
      );
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
