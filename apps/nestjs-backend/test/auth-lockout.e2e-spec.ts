import type { INestApplication } from '@nestjs/common';
import { SIGN_IN } from '@teable/openapi';
import type { AxiosInstance } from 'axios';
import axiosInstance from 'axios';
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
  const password = 'lockout12345A';

  beforeAll(async () => {
    // Lockout is off by default (both values undefined). Customizing the env
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
});
