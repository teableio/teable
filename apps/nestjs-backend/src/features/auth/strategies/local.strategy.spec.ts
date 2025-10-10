/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable sonarjs/no-duplicate-string */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import { mockDeep, mockReset } from 'vitest-mock-extended';
import { CacheService } from '../../../cache/cache.service';
import { GlobalModule } from '../../../global/global.module';
import { UserModule } from '../../user/user.module';
import { LocalAuthService } from '../local-auth/local-auth.service';
import { LocalStrategy } from './local.strategy';

describe('LocalStrategy', () => {
  let localStrategy: LocalStrategy;
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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [GlobalModule, UserModule],
      providers: [LocalStrategy, LocalAuthService],
    })
      .overrideProvider(LocalAuthService)
      .useValue(authService)
      .overrideProvider(CacheService)
      .useValue(cacheService)
      .compile();

    localStrategy = module.get<LocalStrategy>(LocalStrategy);
  });

  afterEach(() => {
    vitest.resetAllMocks();
    mockReset(authService);
    mockReset(cacheService);
  });

  it('should throw error when lockout is disabled', async () => {
    authService.validateUserByEmail.mockRejectedValue(new Error());
    localStrategy['authConfig'].signin = {
      maxLoginAttempts: 0,
      accountLockoutMinutes: 0,
    };
    await expect(localStrategy.validate(mokeReq, testEmail, testPassword)).rejects.toThrow(
      'Email or password is incorrect'
    );
  });

  it('should throw error when account is already locked', async () => {
    authService.validateUserByEmail.mockRejectedValue(new Error());
    localStrategy['authConfig'].signin = {
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
    authService.validateUserByEmail.mockRejectedValue(new Error());
    localStrategy['authConfig'].signin = {
      maxLoginAttempts: 5,
      accountLockoutMinutes: 10,
    };
    cacheService.get.mockImplementation(async (key) => {
      if (key === `signin:lockout:${testEmail}`) return undefined;
      if (key === `signin:attempts:${testEmail}`) return 2;
      return undefined;
    });

    await expect(localStrategy.validate(mokeReq, testEmail, testPassword)).rejects.toMatchObject({
      response: 'Email or password is incorrect',
    });
    expect(cacheService.setDetail).toHaveBeenCalledWith(`signin:attempts:${testEmail}`, 3, 30);
  });

  it('should lock account when max attempts reached', async () => {
    authService.validateUserByEmail.mockRejectedValue(new Error());
    localStrategy['authConfig'].signin = {
      maxLoginAttempts: 4,
      accountLockoutMinutes: 10,
    };
    cacheService.get.mockImplementation(async (key) => {
      if (key === `signin:lockout:${testEmail}`) return false;
      if (key === `signin:attempts:${testEmail}`) return 4;
      return undefined;
    });

    await expect(localStrategy.validate(mokeReq, testEmail, testPassword)).rejects.toMatchObject({
      response: 'Your account has been locked out, please try again after 10 minutes',
    });
    expect(cacheService.set).toHaveBeenCalledWith(`signin:lockout:${testEmail}`, true, 10);
  });

  it('should handle first failed attempt', async () => {
    authService.validateUserByEmail.mockRejectedValue(new Error());
    localStrategy['authConfig'].signin = {
      maxLoginAttempts: 5,
      accountLockoutMinutes: 10,
    };
    cacheService.get.mockImplementation(async () => undefined);

    await expect(localStrategy.validate(mokeReq, testEmail, testPassword)).rejects.toMatchObject({
      response: 'Email or password is incorrect',
    });
    expect(cacheService.setDetail).toHaveBeenCalledWith(`signin:attempts:${testEmail}`, 1, 30);
  });
});
