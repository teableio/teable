/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable sonarjs/no-duplicate-string */
import { ServiceUnavailableException } from '@nestjs/common';
import type { Request } from 'express';
import { mockDeep, mockReset } from 'vitest-mock-extended';
import type { CacheService } from '../../../cache/cache.service';
import type { IAuthConfig } from '../../../configs/auth.config';
import type { UserService } from '../../user/user.service';
import type { LocalAuthService } from '../local-auth/local-auth.service';
import { LocalStrategy } from './local.strategy';

describe('LocalStrategy', () => {
  let localStrategy: LocalStrategy;
  const userService = mockDeep<UserService>();
  const authService = mockDeep<LocalAuthService>();
  const cacheService = mockDeep<CacheService>();
  const testEmail = 'test@test.com';
  const testPassword = '12345678a';
  const mokeReq = {
    ip: '127.0.0.1',
    connection: {
      remoteAddress: '127.0.0.1',
    },
    headers: {
      'x-forwarded-for': '127.0.0.1',
    },
  } as unknown as Request;

  beforeEach(() => {
    localStrategy = new LocalStrategy(
      userService,
      authService,
      cacheService,
      mockDeep<IAuthConfig>()
    );
  });

  afterEach(() => {
    vitest.resetAllMocks();
    mockReset(authService);
    mockReset(cacheService);
    mockReset(userService);
  });

  it('should throw error when lockout is disabled', async () => {
    authService.validateUserByEmailWithTurnstile.mockResolvedValue(null);
    localStrategy['authConfig'].signin = {
      lockoutEnabled: false,
      maxLoginAttempts: 5,
      accountLockoutMinutes: 10,
    };
    await expect(localStrategy.validate(mokeReq, testEmail, testPassword)).rejects.toThrow(
      'Email or password is incorrect'
    );
    expect(cacheService.get).not.toHaveBeenCalled();
    expect(cacheService.incr).not.toHaveBeenCalled();
  });

  it('should throw error when account is already locked', async () => {
    authService.validateUserByEmailWithTurnstile.mockResolvedValue(null);
    localStrategy['authConfig'].signin = {
      lockoutEnabled: true,
      maxLoginAttempts: 5,
      accountLockoutMinutes: 10,
    };
    cacheService.get.mockImplementation(async (key) => {
      if (key === `signin:lockout:${testEmail}`) return true;
      return undefined;
    });

    await expect(localStrategy.validate(mokeReq, testEmail, testPassword)).rejects.toThrow(
      'Your account has been locked out, please try again after 10 minutes'
    );
  });

  it('should increment attempt count and throw error', async () => {
    authService.validateUserByEmailWithTurnstile.mockResolvedValue(null);
    localStrategy['authConfig'].signin = {
      lockoutEnabled: true,
      maxLoginAttempts: 5,
      accountLockoutMinutes: 10,
    };
    cacheService.get.mockResolvedValue(undefined);
    cacheService.incr.mockResolvedValue(3);

    await expect(localStrategy.validate(mokeReq, testEmail, testPassword)).rejects.toMatchObject({
      response: 'Email or password is incorrect',
    });
    expect(cacheService.incr).toHaveBeenCalledWith(`signin:attempts:${testEmail}`, 600);
  });

  it('should lock account when max attempts reached', async () => {
    authService.validateUserByEmailWithTurnstile.mockResolvedValue(null);
    localStrategy['authConfig'].signin = {
      lockoutEnabled: true,
      maxLoginAttempts: 4,
      accountLockoutMinutes: 10,
    };
    cacheService.get.mockResolvedValue(undefined);
    cacheService.incr.mockResolvedValue(4);

    await expect(localStrategy.validate(mokeReq, testEmail, testPassword)).rejects.toMatchObject({
      response: 'Your account has been locked out, please try again after 10 minutes',
    });
    expect(cacheService.set).toHaveBeenCalledWith(`signin:lockout:${testEmail}`, true, 600);
    expect(cacheService.expire).toHaveBeenCalledWith(`signin:attempts:${testEmail}`, 1);
  });

  it('should handle first failed attempt', async () => {
    authService.validateUserByEmailWithTurnstile.mockResolvedValue(null);
    localStrategy['authConfig'].signin = {
      lockoutEnabled: true,
      maxLoginAttempts: 5,
      accountLockoutMinutes: 10,
    };
    cacheService.get.mockResolvedValue(undefined);
    cacheService.incr.mockResolvedValue(1);

    await expect(localStrategy.validate(mokeReq, testEmail, testPassword)).rejects.toMatchObject({
      response: 'Email or password is incorrect',
    });
    expect(cacheService.incr).toHaveBeenCalledWith(`signin:attempts:${testEmail}`, 600);
  });

  describe('server-side failures', () => {
    const lockout = { lockoutEnabled: true, maxLoginAttempts: 5, accountLockoutMinutes: 10 };

    it('does not count a failed credential check as a wrong password', async () => {
      authService.validateUserByEmailWithTurnstile.mockRejectedValue(
        new Error('database unreachable')
      );
      localStrategy['authConfig'].signin = lockout;

      await expect(localStrategy.validate(mokeReq, testEmail, testPassword)).rejects.toThrow(
        'database unreachable'
      );
      expect(cacheService.get).not.toHaveBeenCalled();
      expect(cacheService.incr).not.toHaveBeenCalled();
      expect(cacheService.set).not.toHaveBeenCalled();
    });

    it('does not count a 5xx from the credential check', async () => {
      authService.validateUserByEmailWithTurnstile.mockRejectedValue(
        new ServiceUnavailableException('database unreachable')
      );
      localStrategy['authConfig'].signin = lockout;

      await expect(localStrategy.validate(mokeReq, testEmail, testPassword)).rejects.toBeInstanceOf(
        ServiceUnavailableException
      );
      expect(cacheService.incr).not.toHaveBeenCalled();
    });

    it('does not lock an account the counter already brought to the limit', async () => {
      authService.validateUserByEmailWithTurnstile.mockRejectedValue(
        new Error('database unreachable')
      );
      localStrategy['authConfig'].signin = { ...lockout, maxLoginAttempts: 1 };

      await expect(localStrategy.validate(mokeReq, testEmail, testPassword)).rejects.toThrow(
        'database unreachable'
      );
      expect(cacheService.set).not.toHaveBeenCalled();
    });

    it('surfaces the real error when lockout is disabled', async () => {
      authService.validateUserByEmailWithTurnstile.mockRejectedValue(
        new Error('database unreachable')
      );
      localStrategy['authConfig'].signin = { ...lockout, lockoutEnabled: false };

      await expect(localStrategy.validate(mokeReq, testEmail, testPassword)).rejects.toThrow(
        'database unreachable'
      );
    });
  });
});
