import { describe, expect, it, vi } from 'vitest';
import { relaxOAuthPopupCoop } from './oauth-popup-coop';

function run(path: string) {
  const res = { setHeader: vi.fn() };
  const next = vi.fn();
  relaxOAuthPopupCoop({ path } as never, res as never, next);
  return { res, next };
}

describe('relaxOAuthPopupCoop', () => {
  it.each([
    '/api/oauth/authorize',
    '/api/oauth/decision',
    '/api/auth/github',
    '/api/auth/github/callback',
    '/api/auth/google',
    '/api/auth/google/callback',
    '/api/auth/oidc',
    '/api/auth/oidc/callback',
    '/api/auth/authentication/prv123',
    '/api/auth/authentication/prv123/callback',
    '/api/app-auth/teable/callback',
    '/api/app-auth/google/callback',
    '/auth/login',
    '/oauth/decision',
  ])('relaxes COOP on %s', (path) => {
    const { res, next } = run(path);
    expect(res.setHeader).toHaveBeenCalledWith('Cross-Origin-Opener-Policy', 'unsafe-none');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it.each([
    '/api/oauth/client',
    '/api/oauth/decision-extra',
    '/api/auth/user/me',
    '/api/auth/oidcish',
    '/api/auth/authentication',
    '/api/auth/authentication/prv123/other',
    '/api/app-auth/teable/authorize-url',
    '/api/base/base123/record',
    '/auth/login-history',
    '/space',
  ])('leaves %s untouched', (path) => {
    const { res, next } = run(path);
    expect(res.setHeader).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
