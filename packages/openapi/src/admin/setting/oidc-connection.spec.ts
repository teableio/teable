import { describe, expect, it } from 'vitest';
import { DEFAULT_OIDC_SCOPE, resolveOidcConnection } from './oidc-connection';

const full = {
  authorizationUrl: 'https://idp.example/authorize',
  tokenUrl: 'https://idp.example/token',
  userInfoUrl: 'https://idp.example/userinfo',
  clientId: 'client',
  clientSecret: 'secret',
};

describe('resolveOidcConnection', () => {
  it('returns the trimmed connection with the default scope once every endpoint field is set', () => {
    expect(resolveOidcConnection({ oidc: { ...full, clientId: ' client ' } })).toEqual({
      ...full,
      scope: DEFAULT_OIDC_SCOPE,
    });
  });

  it('carries the configured scope, trimmed, and falls back to the default when blank', () => {
    const resolved = resolveOidcConnection({ oidc: { ...full, scope: ' openid email groups ' } });
    expect(resolved?.scope).toBe('openid email groups');
    expect(resolveOidcConnection({ oidc: { ...full, scope: '  ' } })?.scope).toBe(
      DEFAULT_OIDC_SCOPE
    );
  });

  it('is undefined while any field is missing or blank', () => {
    expect(resolveOidcConnection(undefined)).toBeUndefined();
    expect(resolveOidcConnection({ google: { clientId: 'g' } })).toBeUndefined();
    expect(resolveOidcConnection({ oidc: { ...full, tokenUrl: '  ' } })).toBeUndefined();
    expect(resolveOidcConnection({ oidc: { ...full, clientSecret: undefined } })).toBeUndefined();
  });
});
