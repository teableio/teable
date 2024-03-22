/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import { SpaceRole } from '@teable/core';
import type {
  CreateAccessTokenVo,
  ICreateSpaceVo,
  ITableFullVo,
  UpdateAccessTokenRo,
} from '@teable/openapi';
import {
  createAccessToken,
  deleteAccessToken,
  listAccessToken,
  listAccessTokenVoSchema,
  refreshAccessToken,
  refreshAccessTokenVoSchema,
  updateAccessToken,
  GET_TABLE_LIST,
  urlBuilder,
  GET_RECORDS_URL,
  EMAIL_SPACE_INVITATION,
  CREATE_SPACE,
  CREATE_BASE,
  DELETE_SPACE,
  createAxios,
  axios as defaultAxios,
} from '@teable/openapi';
import dayjs from 'dayjs';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { getError } from './utils/get-error';
import { createTable, deleteTable, initApp } from './utils/init-app';

describe('OpenAPI AccessTokenController (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;
  const spaceId = globalThis.testConfig.spaceId;
  const email = globalThis.testConfig.email;
  const email2 = 'accesstoken@example.com';
  let table: ITableFullVo;
  let token: CreateAccessTokenVo;

  const defaultCreateRo = {
    name: 'token1',
    description: 'token1',
    scopes: ['table|read', 'record|read'],
    baseIds: [baseId],
    spaceIds: [spaceId],
    expiredTime: dayjs(Date.now() + 1000 * 60 * 60 * 24).format('YYYY-MM-DD'),
  };

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    table = await createTable(baseId, { name: 'table1' });
    token = (await createAccessToken(defaultCreateRo)).data;
    expect(token).toHaveProperty('id');
  });

  afterAll(async () => {
    await deleteTable(baseId, table.id);
    const { data } = await listAccessToken();
    for (const { id } of data) {
      await deleteAccessToken(id);
    }
    await app.close();
  });

  it('/api/access-token (GET)', async () => {
    const { data } = await listAccessToken();
    expect(listAccessTokenVoSchema.safeParse(data).success).toEqual(true);

    expect(data.some(({ id }) => id === token.id)).toEqual(true);
  });

  it('/api/access-token/:accessTokenId (PUT)', async () => {
    const { data: newAccessToken } = await createAccessToken(defaultCreateRo);
    const updateRo: UpdateAccessTokenRo = {
      name: 'new token',
      description: 'new desc',
      scopes: ['table|read', 'record|read', 'record|create'],
      baseIds: null,
      spaceIds: null,
    };
    const { data } = await updateAccessToken(newAccessToken.id, updateRo);
    expect(data).toEqual({
      ...updateRo,
      id: newAccessToken.id,
      baseIds: undefined,
      spaceIds: undefined,
    });
  });

  it('/api/access-token/:accessTokenId (DELETE)', async () => {
    const { data: newAccessToken } = await createAccessToken(defaultCreateRo);
    const res = await deleteAccessToken(newAccessToken.id);
    expect(res.status).toEqual(200);
  });

  it('/api/access-token/:accessTokenId/refresh (POST) 200', async () => {
    const { data: newAccessToken } = await createAccessToken(defaultCreateRo);
    const res = await refreshAccessToken(newAccessToken.id, {
      expiredTime: dayjs(Date.now() + 1000 * 60 * 60 * 24).format('YYYY-MM-DD'),
    });
    expect(res.status).toEqual(200);
    expect(refreshAccessTokenVoSchema.safeParse(res.data).success).toEqual(true);
  });

  describe('validate accessToken permission', () => {
    let tableReadToken: string;
    let recordReadToken: string;
    const axios = createAxios();

    beforeAll(async () => {
      const { data: tableReadTokenData } = await createAccessToken({
        ...defaultCreateRo,
        name: 'table read token',
        scopes: ['table|read'],
      });
      tableReadToken = tableReadTokenData.token;
      const { data: recordReadTokenData } = await createAccessToken({
        ...defaultCreateRo,
        name: 'record read token',
        scopes: ['record|read'],
      });
      recordReadToken = recordReadTokenData.token;
      axios.defaults.baseURL = defaultAxios.defaults.baseURL;
    });

    it('get table list has table|read permission', async () => {
      const res = await axios.get(urlBuilder(GET_TABLE_LIST, { baseId }), {
        headers: {
          Authorization: `Bearer ${tableReadToken}`,
        },
      });
      expect(res.status).toEqual(200);
    });

    it('get table list has not table|read permission', async () => {
      const error = await getError(() =>
        axios.get(urlBuilder(GET_TABLE_LIST, { baseId }), {
          headers: {
            Authorization: `Bearer ${recordReadToken}`,
          },
        })
      );
      expect(error?.status).toEqual(403);
    });

    it('get record list has record|read permission', async () => {
      const res = await axios.get(urlBuilder(GET_RECORDS_URL, { tableId: table.id }), {
        headers: {
          Authorization: `Bearer ${recordReadToken}`,
        },
      });
      expect(res.status).toEqual(200);
    });

    it('get record list has not record|read permission', async () => {
      const error = await getError(() =>
        axios.get(urlBuilder(GET_RECORDS_URL, { tableId: table.id }), {
          headers: {
            Authorization: `Bearer ${tableReadToken}`,
          },
        })
      );
      expect(error?.status).toEqual(403);
    });

    it('access token permission < user permission', async () => {
      const newUserAxios = await createNewUserAxios({
        email: email2,
        password: '12345678',
      });

      const { data: newUserSpace } = await newUserAxios.post<ICreateSpaceVo>(CREATE_SPACE, {
        name: 'permission test space',
      });

      const spaceId = newUserSpace.id;
      await newUserAxios.post(urlBuilder(EMAIL_SPACE_INVITATION, { spaceId }), {
        role: SpaceRole.Viewer,
        emails: [email],
      });

      const { data: createBaseAccessTokenData } = await createAccessToken({
        ...defaultCreateRo,
        name: 'base access token',
        scopes: ['base|read'],
        spaceIds: [spaceId],
      });

      const error = await getError(() =>
        axios.post(
          CREATE_BASE,
          { spaceId },
          {
            headers: {
              Authorization: `Bearer ${createBaseAccessTokenData.token}`,
            },
          }
        )
      );
      expect(error?.status).toEqual(403);
      await newUserAxios.delete(urlBuilder(DELETE_SPACE, { spaceId }));
    });
  });
});
