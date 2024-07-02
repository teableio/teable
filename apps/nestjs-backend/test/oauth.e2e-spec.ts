import type { INestApplication } from '@nestjs/common';
import type { OAuthCreateVo } from '@teable/openapi';
import {
  deleteOAuthSecret,
  generateOAuthSecret,
  oauthCreate,
  oauthDelete,
  oauthGet,
  oauthUpdate,
} from '@teable/openapi';
import { getError } from './utils/get-error';
import { initApp } from './utils/init-app';

const oauthData = {
  name: 'test',
  redirectUris: ['http://localhost:3000/callback'],
  scopes: ['user|email_read'],
  homepage: 'http://localhost:3000',
};

describe('OpenAPI OAuthController (e2e)', () => {
  let app: INestApplication;
  let oauth: OAuthCreateVo;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    const res = await oauthCreate(oauthData);
    oauth = res.data;
  });

  afterAll(async () => {
    await app.close();
  });

  it('/api/oauth/client (POST)', async () => {
    const res = await oauthCreate(oauthData);
    expect(res.status).toBe(201);
    expect(res.data).toHaveProperty('clientId');
  });

  it('/api/oauth/client/:clientId (GET)', async () => {
    const res = await oauthGet(oauth.clientId);
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject(oauth);
  });

  it('/api/oauth/client/:clientId (GET) - not found', async () => {
    const error = await getError(() => oauthGet('xxxxxxx'));
    expect(error?.status).toBe(404);
  });

  it('/api/oauth/client/:clientId (DELETE)', async () => {
    const res = await oauthDelete(oauth.clientId);
    expect(res.status).toBe(200);
  });

  it('/api/oauth/client/:clientId (PUT)', async () => {
    const res = await oauthCreate(oauthData);
    const updated = await oauthUpdate(res.data.clientId, { ...res.data, name: 'updated' });
    expect(updated.data.name).toBe('updated');
  });

  it('/api/oauth/client/:clientId/secret (POST)', async () => {
    const res = await oauthCreate(oauthData);
    const secret = await generateOAuthSecret(res.data.clientId);
    expect(secret.data).toHaveProperty('secret');
    expect(secret.data.lastUsedTime).toBeUndefined();

    const oauth = await oauthGet(res.data.clientId);
    expect(oauth.data.secrets).toHaveLength(1);
    expect(oauth.data.secrets?.[0].secret).toEqual(secret.data.maskedSecret);
  });

  it('/api/oauth/client/:clientId/secret (DELETE)', async () => {
    const res = await oauthCreate(oauthData);
    const secret = await generateOAuthSecret(res.data.clientId);
    const deleted = await deleteOAuthSecret(res.data.clientId, secret.data.id);
    expect(deleted.status).toBe(200);

    const oauth = await oauthGet(res.data.clientId);
    expect(oauth.data.secrets).toBeUndefined();
  });
});
