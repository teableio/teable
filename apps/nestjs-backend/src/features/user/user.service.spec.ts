import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { vi } from 'vitest';
import { GlobalModule } from '../../global/global.module';
import { UserModule } from './user.module';
import { UserService } from './user.service';

describe('UserService', () => {
  let service: UserService;

  const createNotifyMetaMergeService = (notifyMeta?: string | null) => {
    const queryRaw = vi.fn().mockResolvedValue([{ notifyMeta }]);
    const update = vi.fn().mockResolvedValue(undefined);
    const tx = vi.fn(async (fn: () => Promise<void>) => await fn());
    const prismaService = {
      $tx: tx,
      txClient: () => ({
        $queryRaw: queryRaw,
        user: {
          update,
        },
      }),
    };
    const mergeService = new UserService(
      prismaService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );

    return {
      mergeService,
      queryRaw,
      tx,
      update,
    };
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [GlobalModule, UserModule],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  const createClaimHarness = (existUser: object | null) => {
    const accountCreate = vi.fn().mockResolvedValue(undefined);
    const userUpdate = vi.fn().mockResolvedValue(undefined);
    const prismaService = {
      $tx: vi.fn(async (fn: () => Promise<unknown>) => await fn()),
      txClient: () => ({
        account: { findFirst: vi.fn().mockResolvedValue(null), create: accountCreate },
        user: { findUnique: vi.fn().mockResolvedValue(existUser), update: userUpdate },
      }),
    };
    const cls = { get: vi.fn().mockReturnValue(undefined) };
    const svc = new UserService(
      prismaService as never,
      cls as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );
    vi.spyOn(svc, 'throwIfEmailDeniedByRiskControl').mockResolvedValue(undefined as never);
    const recordSignup = vi.spyOn(svc, 'recordSignup').mockResolvedValue(undefined as never);
    return { svc, recordSignup, accountCreate };
  };

  const oauthProfile = {
    name: 'Invitee',
    email: 'invitee@acme.com',
    provider: 'google',
    providerId: 'g-1',
    type: 'oauth',
  };

  it('fires signup when OAuth claims an invitation-pre-created user (no password, no accounts)', async () => {
    const { svc, recordSignup, accountCreate } = createClaimHarness({
      id: 'usrClaimed',
      email: 'invitee@acme.com',
      password: null,
      isSystem: null,
      refMeta: null,
      accounts: [],
    });

    await svc.findOrCreateUser(oauthProfile);

    expect(accountCreate).toHaveBeenCalled();
    expect(recordSignup).toHaveBeenCalledWith('usrClaimed');
  });

  it('does NOT fire signup when an already-active user links another provider', async () => {
    const { svc, recordSignup, accountCreate } = createClaimHarness({
      id: 'usrActive',
      email: 'invitee@acme.com',
      password: 'hashed',
      isSystem: null,
      refMeta: null,
      accounts: [],
    });

    await svc.findOrCreateUser(oauthProfile);

    expect(accountCreate).toHaveBeenCalled();
    expect(recordSignup).not.toHaveBeenCalled();
  });

  it('hands the signup to the caller instead of emitting when deferSignupEvent is passed', async () => {
    const { svc, recordSignup } = createClaimHarness({
      id: 'usrClaimed',
      email: 'invitee@acme.com',
      password: null,
      isSystem: null,
      refMeta: null,
      accounts: [],
    });
    const deferred: string[] = [];

    await svc.findOrCreateUser(oauthProfile, true, undefined, (userId) => deferred.push(userId));

    // The SSO strategy wraps this call in its own transaction: the event must
    // not fire in here (emitAsync awaits listeners that read non-tx).
    expect(deferred).toEqual(['usrClaimed']);
    expect(recordSignup).not.toHaveBeenCalled();
  });

  const createAttributionService = (clsValues: Record<string, unknown>) => {
    const cls = { get: vi.fn((key: string) => clsValues[key]) };
    return new UserService(
      {} as never,
      cls as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );
  };

  it('snapshots the OAuth login destination as the query when none exists (link-invite signal)', () => {
    const svc = createAttributionService({ oauthRedirectUri: '/invite?invitationId=invabc123' });

    const refMeta = svc.applySignupAttribution(undefined);

    expect(JSON.parse(refMeta as string)).toEqual({
      query: `?redirect=${encodeURIComponent('/invite?invitationId=invabc123')}`,
    });
  });

  it('never overwrites a real signup-page query snapshot with the OAuth destination', () => {
    const svc = createAttributionService({
      oauthRedirectUri: '/somewhere',
      affiliateVia: 'ariex',
    });

    const refMeta = svc.applySignupAttribution(JSON.stringify({ query: '?utm_source=x' }));

    expect(JSON.parse(refMeta as string)).toEqual({
      query: '?utm_source=x',
      attribution: { via: 'ariex' },
    });
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('merges notify meta updates with existing values', async () => {
    const { mergeService, queryRaw, tx, update } = createNotifyMetaMergeService(
      JSON.stringify({ email: true, appBuilderChatIntroDismissed: true })
    );

    await mergeService.updateNotifyMeta('usrTest', { email: false });

    expect(tx).toHaveBeenCalledTimes(1);
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(queryRaw.mock.calls[0][0].join('')).toContain('FOR UPDATE');
    expect(queryRaw.mock.calls[0][1]).toBe('usrTest');
    expect(update).toHaveBeenCalledWith({
      data: {
        notifyMeta: JSON.stringify({ email: false, appBuilderChatIntroDismissed: true }),
      },
      where: { id: 'usrTest', deletedTime: null },
    });
  });

  it('keeps existing notify switches when dismissing app builder intro', async () => {
    const { mergeService, update } = createNotifyMetaMergeService(JSON.stringify({ email: true }));

    await mergeService.updateNotifyMeta('usrTest', { appBuilderChatIntroDismissed: true });

    expect(update).toHaveBeenCalledWith({
      data: {
        notifyMeta: JSON.stringify({ email: true, appBuilderChatIntroDismissed: true }),
      },
      where: { id: 'usrTest', deletedTime: null },
    });
  });

  it('ignores malformed existing notify meta when merging updates', async () => {
    const { mergeService, update } = createNotifyMetaMergeService('legacy-invalid-json');

    await mergeService.updateNotifyMeta('usrTest', { appBuilderChatIntroDismissed: true });

    expect(update).toHaveBeenCalledWith({
      data: {
        notifyMeta: JSON.stringify({ appBuilderChatIntroDismissed: true }),
      },
      where: { id: 'usrTest', deletedTime: null },
    });
  });
});
