import { BadRequestException } from '@nestjs/common';
import { HttpErrorCode } from '@teable/core';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { CustomHttpException } from '../../../custom.exception';
import { LocalStrategy } from './local.strategy';

const EMAIL = 'ada@example.com';
const user = {
  id: 'usrAda',
  email: EMAIL,
  name: 'Ada',
  password: 'hash',
  avatar: null,
  notifyMeta: {},
  deactivatedTime: null,
};

const createFixture = ({
  validate = vi.fn().mockResolvedValue(user),
  signin = { lockoutEnabled: false, maxLoginAttempts: 5, accountLockoutMinutes: 15 },
  lockedOut = false,
  attempts = 1,
} = {}) => {
  const userService = {
    refreshLastSignTime: vi.fn().mockResolvedValue(undefined),
    recordSigninFailure: vi.fn().mockResolvedValue(undefined),
  };
  const authService = { validateUserByEmailWithTurnstile: validate };
  const cacheService = {
    get: vi.fn().mockResolvedValue(lockedOut || undefined),
    incr: vi.fn().mockResolvedValue(attempts),
    set: vi.fn().mockResolvedValue(undefined),
    expire: vi.fn().mockResolvedValue(undefined),
  };
  const strategy = new LocalStrategy(
    userService as never,
    authService as never,
    cacheService as never,
    { signin } as never
  );
  const req = { body: {}, ip: '127.0.0.1', headers: {}, connection: {} } as unknown as Request;
  return { strategy, userService, req };
};

const lockout = { lockoutEnabled: true, maxLoginAttempts: 3, accountLockoutMinutes: 15 };

describe('LocalStrategy sign-in failure audit', () => {
  it('records nothing on a successful sign-in', async () => {
    const fixture = createFixture();

    await expect(fixture.strategy.validate(fixture.req, EMAIL, 'right')).resolves.toMatchObject({
      id: 'usrAda',
    });
    expect(fixture.userService.refreshLastSignTime).toHaveBeenCalledWith('usrAda');
    expect(fixture.userService.recordSigninFailure).not.toHaveBeenCalled();
  });

  it('records a wrong password', async () => {
    const fixture = createFixture({ validate: vi.fn().mockResolvedValue(null) });

    await expect(fixture.strategy.validate(fixture.req, EMAIL, 'wrong')).rejects.toMatchObject({
      code: HttpErrorCode.INVALID_CREDENTIALS,
    });
    expect(fixture.userService.recordSigninFailure).toHaveBeenCalledWith({
      email: EMAIL,
      method: 'password',
      reason: 'wrong-password',
    });
  });

  it('records a deactivated account that gave the right password', async () => {
    const fixture = createFixture({
      validate: vi.fn().mockResolvedValue({ ...user, deactivatedTime: new Date() }),
    });

    await expect(fixture.strategy.validate(fixture.req, EMAIL, 'right')).rejects.toBeInstanceOf(
      CustomHttpException
    );
    expect(fixture.userService.recordSigninFailure).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'deactivated' })
    );
    expect(fixture.userService.refreshLastSignTime).not.toHaveBeenCalled();
  });

  it('records a failed captcha', async () => {
    const fixture = createFixture({
      validate: vi.fn().mockRejectedValue(new BadRequestException('Turnstile token is required')),
    });

    await expect(fixture.strategy.validate(fixture.req, EMAIL, 'right')).rejects.toBeDefined();
    expect(fixture.userService.recordSigninFailure).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'captcha' })
    );
  });

  it('leaves the reason to the account state when an account check rejects', async () => {
    const fixture = createFixture({
      validate: vi
        .fn()
        .mockRejectedValue(
          new CustomHttpException(`${EMAIL} not registered`, HttpErrorCode.VALIDATION_ERROR)
        ),
    });

    await expect(fixture.strategy.validate(fixture.req, EMAIL, 'x')).rejects.toBeDefined();
    expect(fixture.userService.recordSigninFailure).toHaveBeenCalledWith({
      email: EMAIL,
      method: 'password',
      reason: undefined,
    });
  });

  it('counts the attempt when lockout is enabled', async () => {
    const fixture = createFixture({
      validate: vi.fn().mockResolvedValue(null),
      signin: lockout,
      attempts: 2,
    });

    await expect(fixture.strategy.validate(fixture.req, EMAIL, 'wrong')).rejects.toMatchObject({
      code: HttpErrorCode.INVALID_CREDENTIALS,
    });
    expect(fixture.userService.recordSigninFailure).toHaveBeenCalledWith({
      email: EMAIL,
      method: 'password',
      reason: 'wrong-password',
      attempts: 2,
    });
  });

  it('records the lockout when the attempt crosses the limit', async () => {
    const fixture = createFixture({
      validate: vi.fn().mockResolvedValue(null),
      signin: lockout,
      attempts: 3,
    });

    await expect(fixture.strategy.validate(fixture.req, EMAIL, 'wrong')).rejects.toMatchObject({
      code: HttpErrorCode.TOO_MANY_REQUESTS,
    });
    expect(fixture.userService.recordSigninFailure).toHaveBeenCalledTimes(1);
    expect(fixture.userService.recordSigninFailure).toHaveBeenCalledWith({
      email: EMAIL,
      method: 'password',
      reason: 'wrong-password',
      attempts: 3,
      lockoutMinutes: 15,
    });
  });

  it('records attempts made while the account is locked out as locked', async () => {
    const fixture = createFixture({
      validate: vi.fn().mockResolvedValue(null),
      signin: lockout,
      lockedOut: true,
    });

    await expect(fixture.strategy.validate(fixture.req, EMAIL, 'wrong')).rejects.toMatchObject({
      code: HttpErrorCode.TOO_MANY_REQUESTS,
    });
    expect(fixture.userService.recordSigninFailure).toHaveBeenCalledWith({
      email: EMAIL,
      method: 'password',
      reason: 'locked',
    });
  });
});
