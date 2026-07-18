import {
  extractViaFromUrl,
  readAffiliateViaFromCookie,
  resolveAffiliateCookieDomain,
} from './affiliate-cookie';

describe('affiliate-cookie', () => {
  describe('resolveAffiliateCookieDomain', () => {
    it('widens production hosts to their apex domain', () => {
      expect(resolveAffiliateCookieDomain('app.teable.ai')).toBe('.teable.ai');
      expect(resolveAffiliateCookieDomain('teable.ai')).toBe('.teable.ai');
      expect(resolveAffiliateCookieDomain('app.teable.cn')).toBe('.teable.cn');
    });

    it('stays host-only for localhost, previews and lookalike hosts', () => {
      expect(resolveAffiliateCookieDomain('localhost')).toBeUndefined();
      expect(resolveAffiliateCookieDomain('feat-x.localhost')).toBeUndefined();
      expect(resolveAffiliateCookieDomain('teable.vercel.app')).toBeUndefined();
      // Suffix match must be label-aligned: eviteable.ai is NOT a teable.ai host.
      expect(resolveAffiliateCookieDomain('eviteable.ai')).toBeUndefined();
    });
  });

  describe('extractViaFromUrl', () => {
    it('reads a plain ?via= token', () => {
      expect(extractViaFromUrl(new URL('https://app.teable.ai/?via=ariex'))).toBe('ariex');
      expect(extractViaFromUrl(new URL('https://app.teable.ai/space?x=1&via=%20kol%20'))).toBe(
        'kol'
      );
    });

    it('digs the token out of an encoded ?redirect= param', () => {
      const url = new URL(
        `https://app.teable.ai/auth/login?redirect=${encodeURIComponent('/space?via=ariex')}`
      );
      expect(extractViaFromUrl(url)).toBe('ariex');
    });

    it('survives a redirect target containing a literal percent sign', () => {
      // Regression: a second decodeURIComponent used to throw on '%of'.
      const url = new URL(
        `https://app.teable.ai/auth/login?redirect=${encodeURIComponent('/pricing?coupon=50%off&via=kol')}`
      );
      expect(extractViaFromUrl(url)).toBe('kol');
    });

    it('prefers the direct param over the redirect-embedded one', () => {
      const url = new URL(
        `https://app.teable.ai/auth/login?via=direct&redirect=${encodeURIComponent('/x?via=nested')}`
      );
      expect(extractViaFromUrl(url)).toBe('direct');
    });

    it('returns undefined for missing / empty / malformed inputs', () => {
      expect(extractViaFromUrl(new URL('https://app.teable.ai/'))).toBeUndefined();
      expect(extractViaFromUrl(new URL('https://app.teable.ai/?via='))).toBeUndefined();
      expect(extractViaFromUrl(new URL('https://app.teable.ai/?redirect=%'))).toBeUndefined();
      expect(
        extractViaFromUrl(new URL('https://app.teable.ai/?redirect=%2Fspace'))
      ).toBeUndefined();
    });
  });

  describe('readAffiliateViaFromCookie', () => {
    afterEach(() => {
      document.cookie = 'teable_affiliate_via=; max-age=0';
      document.cookie = 'x_teable_affiliate_via=; max-age=0';
    });

    it('reads and decodes the affiliate cookie, ignoring lookalike names', () => {
      document.cookie = 'x_teable_affiliate_via=nope';
      document.cookie = 'teable_affiliate_via=k%20ol';
      expect(readAffiliateViaFromCookie()).toBe('k ol');
    });

    it('returns undefined when the cookie is absent', () => {
      expect(readAffiliateViaFromCookie()).toBeUndefined();
    });
  });
});
