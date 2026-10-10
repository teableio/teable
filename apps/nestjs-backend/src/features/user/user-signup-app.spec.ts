import { AsyncLocalStorage } from 'node:async_hooks';
import { ClsService } from 'nestjs-cls';
import { describe, expect, it, vi } from 'vitest';
import type { IClsStore } from '../../types/cls';
import { AppSignupUnavailableException } from '../auth/app-signup-unavailable.exception';
import { UserService } from './user.service';

const consent = (platform: string) =>
  `/auth/mobile?code_challenge=${'c'.repeat(43)}&state=st&redirect_uri=teable%3A%2F%2Fauth%2Fcallback&platform=${platform}`;

const createFixture = () => {
  const cls = new ClsService<IClsStore>(new AsyncLocalStorage());
  const settingService = { getSetting: vi.fn().mockResolvedValue({}) };
  const tx = {
    account: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() },
    user: { update: vi.fn() },
  };
  const prismaService = {
    $tx: (fn: () => Promise<unknown>) => fn(),
    txClient: () => tx,
  };
  const service = new UserService(
    prismaService as never,
    cls,
    {} as never,
    settingService as never,
    {} as never,
    {} as never,
    {} as never,
    { isCloud: true } as never,
    {} as never,
    {} as never
  );
  const createUser = vi.spyOn(service, 'createUser').mockResolvedValue({ id: 'usrNew' } as never);
  vi.spyOn(service, 'throwIfEmailDeniedByRiskControl').mockResolvedValue(undefined);
  vi.spyOn(service, 'recordSignup').mockResolvedValue(undefined as never);
  return { cls, service, settingService, createUser, tx };
};

const googleUser = {
  name: 'Invitee',
  email: 'invitee@example.com',
  provider: 'google',
  providerId: 'g-1',
  type: 'oauth',
};

describe('UserService: no accounts from the iOS app', () => {
  it('refuses an OAuth sign-up headed back to the iOS app, keeping where it was going', async () => {
    const { cls, service, settingService, createUser } = createFixture();
    const rejected = await cls.run(async () => {
      cls.set('oauthRedirectUri', consent('ios'));
      return service
        .createUserWithSettingCheck({ id: 'usrNew', email: 'new@example.com' })
        .catch((error: unknown) => error);
    });
    expect(rejected).toBeInstanceOf(AppSignupUnavailableException);
    expect((rejected as AppSignupUnavailableException).redirect).toBe(consent('ios'));
    // Refused before anything is read or written.
    expect(settingService.getSetting).not.toHaveBeenCalled();
    expect(createUser).not.toHaveBeenCalled();
  });

  it('refuses a password sign-up sent from the login page of an iOS app sign-in', async () => {
    const { cls, service, createUser } = createFixture();
    const refMeta = JSON.stringify({ query: `?redirect=${encodeURIComponent(consent('ios'))}` });
    const rejected = await cls.run(() =>
      service
        .createUserWithSettingCheck({ id: 'usrNew', email: 'new@example.com', refMeta })
        .catch((error: unknown) => error)
    );
    expect(rejected).toBeInstanceOf(AppSignupUnavailableException);
    expect(createUser).not.toHaveBeenCalled();
    expect(() =>
      service.assertSignupAllowedHere(`?redirect=${encodeURIComponent(consent('ios'))}`)
    ).toThrow(AppSignupUnavailableException);
  });

  it('lets the iOS app claim an invited account or link an active one, never create one', async () => {
    const { cls, service, tx, createUser } = createFixture();
    const getUserByEmail = vi.spyOn(service, 'getUserByEmail');
    const signIn = (user: object) => {
      getUserByEmail.mockResolvedValue(user as never);
      return cls.run(async () => {
        cls.set('oauthRedirectUri', consent('ios'));
        return service.findOrCreateUser(googleUser);
      });
    };

    // Invited, never signed in (no password, no provider): the invitee claims what a
    // customer's invitation made for them. That is not registering a new account.
    await expect(signIn({ id: 'usrInvited', accounts: [] })).resolves.toMatchObject({
      id: 'usrInvited',
    });
    // Already active (a password): adding Google is a sign-in.
    await expect(
      signIn({ id: 'usrActive', password: 'hash', accounts: [] })
    ).resolves.toMatchObject({ id: 'usrActive' });
    expect(tx.account.create).toHaveBeenCalledTimes(2);

    // Nobody behind the email: that would be a new account, which the app does not make.
    await expect(signIn(null as never)).rejects.toBeInstanceOf(AppSignupUnavailableException);
    expect(createUser).not.toHaveBeenCalled();
  });

  it('still signs people up from the Android app, the Web and older app builds', async () => {
    const { cls, service, createUser } = createFixture();
    await cls.run(async () => {
      cls.set('oauthRedirectUri', consent('android'));
      await service.createUserWithSettingCheck({ id: 'usrA', email: 'a@example.com' });
    });
    await cls.run(async () => {
      cls.set('oauthRedirectUri', '/space');
      await service.createUserWithSettingCheck({ id: 'usrB', email: 'b@example.com' });
    });
    await cls.run(() =>
      service.createUserWithSettingCheck({
        id: 'usrC',
        email: 'c@example.com',
        refMeta: JSON.stringify({ query: '?redirect=%2Fauth%2Fmobile%3Fstate%3Dold' }),
      })
    );
    expect(createUser).toHaveBeenCalledTimes(3);
  });
});
