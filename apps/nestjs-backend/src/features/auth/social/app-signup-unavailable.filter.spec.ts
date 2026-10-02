import type { ArgumentsHost } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AppSignupUnavailableException } from '../app-signup-unavailable.exception';
import { AppSignupUnavailableFilter } from './app-signup-unavailable.filter';

const appRedirect =
  '/auth/mobile?code_challenge=challenge&state=st&redirect_uri=teable%3A%2F%2Fauth%2Fcallback&platform=ios';

const run = (exception: AppSignupUnavailableException) => {
  const res = { setHeader: vi.fn(), redirect: vi.fn() };
  const host = {
    switchToHttp: () => ({ getResponse: () => res }),
  } as unknown as ArgumentsHost;
  new AppSignupUnavailableFilter().catch(exception, host);
  const [status, location] = res.redirect.mock.calls[0];
  return { res, status, url: new URL(location, 'https://app.teable.test') };
};

describe('AppSignupUnavailableFilter', () => {
  it('returns the browser to the login page with the notice, still headed for the app', () => {
    const { res, status, url } = run(new AppSignupUnavailableException(appRedirect));
    expect(status).toBe(303);
    expect(url.pathname).toBe('/auth/login');
    expect(url.searchParams.get('authError')).toBe('app_signup_unavailable');
    expect(url.searchParams.get('redirect')).toBe(appRedirect);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  it.each([undefined, 'https://attacker.example/auth/mobile', '//attacker.example'])(
    'drops a redirect that is not a same-origin path: %s',
    (redirect) => {
      const { url } = run(new AppSignupUnavailableException(redirect));
      expect(url.searchParams.get('authError')).toBe('app_signup_unavailable');
      expect(url.searchParams.has('redirect')).toBe(false);
    }
  );
});
