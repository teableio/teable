/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest';
import { OAuthService } from './oauth.service';

const USER_ID = 'usrOwner';
const CLIENT_ID = 'clientAbc';

const app = (overrides: Record<string, unknown> = {}) => ({
  id: 'oapp1',
  clientId: CLIENT_ID,
  name: 'My app',
  description: null,
  logo: null,
  homepage: 'https://app.example.com',
  scopes: JSON.stringify(['user|email_read']),
  redirectUris: JSON.stringify(['https://app.example.com/cb']),
  allowDeviceFlow: false,
  createdBy: USER_ID,
  ...overrides,
});

const createFixture = (clsValues: Record<string, unknown> = {}) => {
  const prisma: any = {
    oAuthApp: {
      create: vi.fn().mockResolvedValue(app()),
      findUnique: vi.fn().mockResolvedValue(app()),
      update: vi.fn().mockResolvedValue(app()),
      delete: vi.fn().mockResolvedValue(app()),
    },
    oAuthAppSecret: {
      create: vi.fn().mockResolvedValue({ id: 'sec1', lastUsedTime: null }),
      delete: vi.fn().mockResolvedValue(undefined),
      findMany: vi.fn().mockResolvedValue([]),
    },
    oAuthAppAuthorized: {
      deleteMany: vi.fn().mockResolvedValue({ count: 3 }),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    oAuthAppToken: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    accessToken: {
      findMany: vi.fn().mockResolvedValue([{ id: 'acc1' }, { id: 'acc2' }]),
      deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
    },
    $tx: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => await fn(prisma)),
  };
  const values = new Map<string, unknown>([
    ['user.id', USER_ID],
    ['user', { id: USER_ID, isAdmin: false }],
    ...Object.entries(clsValues),
  ]);
  const cls = { get: vi.fn((key: string) => values.get(key)) };
  const audit = { emitAtomic: vi.fn().mockResolvedValue(undefined) };
  const service = new OAuthService(
    prisma as never,
    cls as never,
    { del: vi.fn().mockResolvedValue(undefined) } as never,
    audit as never,
    {} as never
  );
  const rows = () => audit.emitAtomic.mock.calls.map(([row]) => row);
  return { service, prisma, audit, rows };
};

describe('OAuthService audit', () => {
  it('writes oauth-app.create keyed by the new client id', async () => {
    const fixture = createFixture();

    await fixture.service.createOAuth({
      name: 'My app',
      homepage: 'https://app.example.com',
      scopes: ['user|email_read'],
      redirectUris: ['https://app.example.com/cb'],
    });

    expect(fixture.rows()).toEqual([
      {
        action: 'oauth-app.create',
        resourceId: CLIENT_ID,
        params: {
          clientId: CLIENT_ID,
          name: 'My app',
          scopes: ['user|email_read'],
          redirectUris: ['https://app.example.com/cb'],
          homepage: 'https://app.example.com',
          allowDeviceFlow: false,
        },
      },
    ]);
  });

  it('writes oauth-app.update with each changed setting before and after', async () => {
    const fixture = createFixture();
    fixture.prisma.oAuthApp.update.mockResolvedValue(
      app({
        scopes: JSON.stringify(['user|email_read', 'record|read']),
        redirectUris: JSON.stringify(['https://evil.example.com/cb']),
      })
    );

    await fixture.service.updateOAuth(CLIENT_ID, {
      name: 'My app',
      homepage: 'https://app.example.com',
      scopes: ['user|email_read', 'record|read'],
      redirectUris: ['https://evil.example.com/cb'],
    });

    expect(fixture.rows()).toEqual([
      {
        action: 'oauth-app.update',
        resourceId: CLIENT_ID,
        params: {
          clientId: CLIENT_ID,
          name: 'My app',
          changes: {
            scopes: { before: ['user|email_read'], after: ['user|email_read', 'record|read'] },
            redirectUris: {
              before: ['https://app.example.com/cb'],
              after: ['https://evil.example.com/cb'],
            },
          },
        },
      },
    ]);
  });

  it('writes nothing for an update that changed no setting', async () => {
    const fixture = createFixture();

    await fixture.service.updateOAuth(CLIENT_ID, {
      name: 'My app',
      homepage: 'https://app.example.com',
      scopes: ['user|email_read'],
      redirectUris: ['https://app.example.com/cb'],
    });

    expect(fixture.audit.emitAtomic).not.toHaveBeenCalled();
  });

  it('writes oauth-app.delete with the number of revoked tokens', async () => {
    const fixture = createFixture();

    await fixture.service.deleteOAuth(CLIENT_ID);

    expect(fixture.rows()).toEqual([
      {
        action: 'oauth-app.delete',
        resourceId: CLIENT_ID,
        params: { clientId: CLIENT_ID, name: 'My app', revokedTokenCount: 2 },
      },
    ]);
  });

  it('writes nothing when a non-owner tries to delete', async () => {
    const fixture = createFixture({ user: { id: 'usrOther', isAdmin: false } });

    await expect(fixture.service.deleteOAuth(CLIENT_ID)).rejects.toThrow('No permission');
    expect(fixture.audit.emitAtomic).not.toHaveBeenCalled();
  });

  it('writes oauth-app.secret.create with the secret id only', async () => {
    const fixture = createFixture();

    const result = await fixture.service.generateSecret(CLIENT_ID);

    expect(fixture.rows()).toEqual([
      {
        action: 'oauth-app.secret.create',
        resourceId: CLIENT_ID,
        params: { clientId: CLIENT_ID, secretId: 'sec1' },
      },
    ]);
    const written = JSON.stringify(fixture.rows());
    expect(written).not.toContain(result.secret);
    expect(written).not.toContain(result.maskedSecret);
  });

  it('writes oauth-app.secret.delete', async () => {
    const fixture = createFixture();

    await fixture.service.deleteSecret(CLIENT_ID, 'sec1');

    expect(fixture.rows()).toEqual([
      {
        action: 'oauth-app.secret.delete',
        resourceId: CLIENT_ID,
        params: { clientId: CLIENT_ID, secretId: 'sec1' },
      },
    ]);
  });

  it('writes oauth-app.access.revoke when the owner revokes every grant', async () => {
    const fixture = createFixture();

    await fixture.service.revokeAccess(CLIENT_ID);

    expect(fixture.rows()).toEqual([
      {
        action: 'oauth-app.access.revoke',
        resourceId: CLIENT_ID,
        params: { clientId: CLIENT_ID, revokedUserCount: 3, revokedTokenCount: 2 },
      },
    ]);
  });

  it('writes oauth-app.token.revoke when a user withdraws their own grant', async () => {
    const fixture = createFixture();

    await fixture.service.revokeToken(CLIENT_ID);

    expect(fixture.rows()).toEqual([
      {
        action: 'oauth-app.token.revoke',
        resourceId: CLIENT_ID,
        params: { clientId: CLIENT_ID, revokedTokenCount: 2, byApp: false },
      },
    ]);
  });

  it('marks a revoke made by the app with its own access token', async () => {
    const fixture = createFixture({ accessTokenId: 'accApp' });

    await fixture.service.revokeToken(CLIENT_ID);

    expect(fixture.rows()[0]).toMatchObject({ params: { byApp: true } });
  });
});
