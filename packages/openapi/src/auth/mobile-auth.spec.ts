import { isAppSignupBlocked, isAppSignupBlockedQuery } from './mobile-auth';

const consent = (platform?: string) => {
  const params = new URLSearchParams({
    code_challenge: 'c'.repeat(43),
    state: 'st',
    redirect_uri: 'teable://auth/callback',
  });
  if (platform) params.set('platform', platform);
  return `/auth/mobile?${params.toString()}`;
};

describe('isAppSignupBlocked', () => {
  it('blocks sign-up only on the iOS app consent page', () => {
    expect(isAppSignupBlocked(consent('ios'))).toBe(true);
    expect(isAppSignupBlocked(consent('android'))).toBe(false);
    // An app build from before the parameter existed keeps signing people up.
    expect(isAppSignupBlocked(consent())).toBe(false);
  });

  it('ignores every other destination', () => {
    expect(isAppSignupBlocked(undefined)).toBe(false);
    expect(isAppSignupBlocked('')).toBe(false);
    expect(isAppSignupBlocked('/space?platform=ios')).toBe(false);
    expect(isAppSignupBlocked('/auth/mobile-other?platform=ios')).toBe(false);
    expect(isAppSignupBlocked('https://evil.example/auth/mobile?platform=ios')).toBe(false);
  });
});

describe('isAppSignupBlockedQuery', () => {
  it('reads the login page redirect, however it was encoded', () => {
    expect(isAppSignupBlockedQuery(`?redirect=${encodeURIComponent(consent('ios'))}`)).toBe(true);
    expect(isAppSignupBlockedQuery(`redirect=${encodeURIComponent(consent('ios'))}&x=1`)).toBe(
      true
    );
    expect(isAppSignupBlockedQuery(`?redirect=${encodeURIComponent(consent('android'))}`)).toBe(
      false
    );
    expect(isAppSignupBlockedQuery('?redirect=%2Fspace')).toBe(false);
    expect(isAppSignupBlockedQuery(undefined)).toBe(false);
  });
});
