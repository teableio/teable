import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import type { OAuthCreateVo } from '@teable/openapi';
import {
  OAUTH_DELETE,
  OAUTH_GET,
  OAUTH_SECRET_DELETE,
  OAUTH_SECRET_GENERATE,
  OAUTH_UPDATE,
  REVOKE_ACCESS,
  deleteOAuthSecret,
  generateOAuthSecret,
  oauthCreate,
  oauthDelete,
  oauthGet,
  oauthUpdate,
  urlBuilder,
} from '@teable/openapi';
import type { AxiosInstance } from 'axios';
import { createNewUserAxios } from './utils/axios-instance/new-user';
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

  it('test oauth app foreign key', async () => {
    const prisma = app.get(PrismaService);
    const clientId = 'test-client-id-' + Date.now();
    await prisma.oAuthApp.create({
      data: {
        name: 'test',
        clientId,
        createdBy: 'test',
        homepage: 'http://localhost:3000',
      },
    });
    const secret = await prisma.oAuthAppSecret.create({
      data: {
        clientId,
        secret: 'test-secret-' + Date.now(),
        maskedSecret: '**********',
        createdBy: 'test',
      },
    });
    await prisma.oAuthAppToken.create({
      data: {
        clientId,
        appSecretId: secret.id,
        refreshTokenSign: 'test-refresh-token-sign-' + Date.now(),
        expiredTime: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
        createdBy: 'test',
      },
    });
    await prisma.oAuthAppAuthorized.create({
      data: {
        clientId,
        userId: 'test',
        authorizedTime: new Date(),
      },
    });
    await prisma.oAuthApp.delete({
      where: {
        clientId,
      },
    });

    const oauthRes = await prisma.oAuthApp.findUnique({
      where: {
        clientId,
      },
    });
    expect(oauthRes).toBeNull();

    const secretRes = await prisma.oAuthAppSecret.findMany({
      where: {
        clientId,
      },
    });
    expect(secretRes).toHaveLength(0);

    const tokenRes = await prisma.oAuthAppToken.findMany({
      where: {
        appSecretId: secret.id,
      },
    });
    expect(tokenRes).toHaveLength(0);

    const authorizedRes = await prisma.oAuthAppAuthorized.findMany({
      where: {
        clientId,
      },
    });
    expect(authorizedRes).toHaveLength(0);
  });

  // The management endpoints below carry no @Permissions decorator, so ownership
  // is enforced entirely by OAuthService.validateOwnership. These cases lock that in:
  // a logged-in user must not be able to operate on an OAuth app they do not own.
  describe('ownership (cross-user)', () => {
    let ownerApp: OAuthCreateVo;
    let ownerSecretId: string;
    let intruder: AxiosInstance;

    beforeAll(async () => {
      intruder = await createNewUserAxios({
        email: `oauth-intruder+${Date.now()}@example.com`,
        password: '12345678',
      });
    });

    beforeEach(async () => {
      ownerApp = (await oauthCreate(oauthData)).data;
      ownerSecretId = (await generateOAuthSecret(ownerApp.clientId)).data.id;
    });

    afterEach(async () => {
      await oauthDelete(ownerApp.clientId).catch(() => undefined);
    });

    const forbiddenCases: Array<[string, (clientId: string) => Promise<unknown>]> = [
      ['GET client', (clientId) => intruder.get(urlBuilder(OAUTH_GET, { clientId }))],
      ['PUT client', (clientId) => intruder.put(urlBuilder(OAUTH_UPDATE, { clientId }), oauthData)],
      ['DELETE client', (clientId) => intruder.delete(urlBuilder(OAUTH_DELETE, { clientId }))],
      ['POST secret', (clientId) => intruder.post(urlBuilder(OAUTH_SECRET_GENERATE, { clientId }))],
      [
        'DELETE secret',
        (clientId) =>
          intruder.delete(urlBuilder(OAUTH_SECRET_DELETE, { clientId, secretId: ownerSecretId })),
      ],
      ['POST revoke-access', (clientId) => intruder.post(urlBuilder(REVOKE_ACCESS, { clientId }))],
    ];

    it.each(forbiddenCases)('non-owner %s -> 403', async (_label, call) => {
      const error = await getError(() => call(ownerApp.clientId));
      expect(error?.status).toBe(403);
    });
  });
});
