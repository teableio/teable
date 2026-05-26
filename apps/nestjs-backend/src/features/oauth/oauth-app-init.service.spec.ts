import { cliOAuthApp } from '@teable/core';
import type { PrismaService } from '@teable/db-main-prisma';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DistributedLockService } from '../../distributed-lock';
import { OAuthAppInitService } from './oauth-app-init.service';

describe('OAuthAppInitService', () => {
  const oAuthApp = { upsert: vi.fn() };
  // Lock stub: run the guarded task immediately, as if the lock were acquired.
  const distributedLock = {
    runExclusive: vi.fn(async (_name: string, _ttl: number, task: () => Promise<void>) => {
      await task();
      return true;
    }),
  };

  const prismaService = { oAuthApp } as unknown as PrismaService;
  const lockService = distributedLock as unknown as DistributedLockService;
  const newService = () => new OAuthAppInitService(prismaService, lockService);

  /** The serialized `oauth_app` payload derived from `cliOAuthApp`. */
  const data = {
    name: cliOAuthApp.name,
    homepage: cliOAuthApp.homepage,
    description: cliOAuthApp.description,
    logo: cliOAuthApp.logo,
    redirectUris: JSON.stringify(cliOAuthApp.redirectUris),
    scopes: JSON.stringify(cliOAuthApp.scopes),
  };

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('seeds the CLI OAuth app under a distributed lock', async () => {
    oAuthApp.upsert.mockResolvedValue({});

    await newService().onModuleInit();

    expect(distributedLock.runExclusive).toHaveBeenCalledWith(
      'oauth-app-init',
      60,
      expect.any(Function)
    );
    expect(oAuthApp.upsert).toHaveBeenCalledWith({
      where: { clientId: cliOAuthApp.clientId },
      create: { clientId: cliOAuthApp.clientId, createdBy: 'system', ...data },
      update: data,
    });
  });

  it('ignores a concurrent-create unique conflict (P2002)', async () => {
    oAuthApp.upsert.mockRejectedValue({ code: 'P2002' });

    await expect(newService().onModuleInit()).resolves.toBeUndefined();
  });

  it('rethrows unexpected errors', async () => {
    oAuthApp.upsert.mockRejectedValue(new Error('database unavailable'));

    await expect(newService().onModuleInit()).rejects.toThrow('database unavailable');
  });
});
