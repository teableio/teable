import type { INestApplication } from '@nestjs/common';
import { HttpErrorCode } from '@teable/core';
import { SIGN_IN } from '@teable/openapi';
import type { AxiosInstance } from 'axios';
import axiosInstance from 'axios';
import { vi } from 'vitest';
import { UserService } from '../src/features/user/user.service';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { initApp } from './utils/init-app';

/**
 * Sign-in attempt limiting on the real cache store. The limiter composes
 * incr() (count the failures) with expire() and set() (lock out), and those
 * commands historically wrote different physical Redis key layouts — a drift
 * the unit specs' idealized in-memory cache cannot see. If incr stops
 * counting on the key the rest of the flow uses, attempts stay at 1 forever
 * and the lockout assertions below go red.
 */
describe('Auth sign-in lockout (e2e)', () => {
  let app: INestApplication;
  let bare: AxiosInstance;
  const email = `lockout+${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const outageEmail = `outage+${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = 'lockout12345A';

  beforeAll(async () => {
    // Lockout is on by default (5 attempts / 15 minutes). Customizing the env
    // makes initApp boot a private app with this config frozen in, instead of
    // reusing the worker's shared one.
    process.env.SIGNIN_MAX_LOGIN_ATTEMPTS = '3';
    process.env.SIGNIN_ACCOUNT_LOCKOUT_MINUTES = '1';
    const appCtx = await initApp();
    app = appCtx.app;
    bare = axiosInstance.create({
      baseURL: `${appCtx.appUrl}/api`,
      validateStatus: () => true,
    });
    await createNewUserAxios({ email, password });
    await createNewUserAxios({ email: outageEmail, password });
  });

  afterAll(async () => {
    await app.close();
  });

  it('locks the account after too many failed attempts', async () => {
    const attempt = (pwd: string) => bare.post(SIGN_IN, { email, password: pwd });

    const first = await attempt('wrong-12345A');
    const second = await attempt('wrong-12345A');
    expect(first.status).toBeGreaterThanOrEqual(400);
    expect(first.status).not.toBe(429);
    expect(second.status).not.toBe(429);

    // The third failure crosses maxLoginAttempts — which requires the Redis
    // counter to actually have read 1, 2, 3 across requests.
    const third = await attempt('wrong-12345A');
    expect(third.status).toBe(429);
    expect(third.data.message).toMatch(/locked out/);

    // Wrong guesses stay throttled for the whole window.
    const stillLocked = await attempt('wrong-12345A');
    expect(stillLocked.status).toBe(429);

    // Current semantics: the lockout throttles guessing, it does not bar the
    // owner — the correct password signs in even during the window (so a
    // spammer cannot lock the real owner out of their account).
    const owner = await attempt(password);
    expect(owner.status).toBe(200);
  });

  it('does not count a server-side failure as a wrong password', async () => {
    const attempt = (pwd: string) => bare.post(SIGN_IN, { email: outageEmail, password: pwd });
    // The sign-in strategy of the app that answers on appUrl is the one passport uses, so
    // its UserService is the one the credential check goes through.
    const userService = app.get(UserService);
    const outage = vi
      .spyOn(userService, 'getUserByEmail')
      .mockRejectedValue(new Error('database unreachable'));
    try {
      // As many retries with the right password as it takes to lock the account on wrong
      // guesses — each one is the server failing, none of them a failed attempt.
      for (let i = 0; i < 3; i++) {
        const res = await attempt(password);
        expect(res.status).toBe(500);
        expect(res.data.code).toBe(HttpErrorCode.INTERNAL_SERVER_ERROR);
        expect(res.data.message).not.toMatch(/incorrect|locked out/);
      }
    } finally {
      outage.mockRestore();
    }

    // The counter never moved: a wrong guess is still a plain rejection, not a lockout ...
    const wrong = await attempt('wrong-12345A');
    expect(wrong.status).toBe(400);
    expect(wrong.data.code).toBe(HttpErrorCode.INVALID_CREDENTIALS);

    // ... and the owner signs in as soon as the service is back.
    const owner = await attempt(password);
    expect(owner.status).toBe(200);
  });
});
