/**
 * @vitest-environment node
 *
 * node, not happy-dom: happy-dom's Request strips fetch-spec forbidden headers
 * (host, cookie), which this suite must set to simulate proxied requests.
 */
import { AFFILIATE_COOKIE_NAME } from '@teable/core';
import { NextRequest } from 'next/server';
import { captureAffiliateVia } from './affiliate-cookie-proxy';

const makeRequest = (url: string, headers: Record<string, string> = {}) =>
  new NextRequest(url, { headers });

describe('captureAffiliateVia', () => {
  beforeEach(() => {
    vi.stubEnv('PUBLIC_ORIGIN', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns null when the request carries no token', () => {
    expect(captureAffiliateVia(makeRequest('https://app.teable.ai/'))).toBeNull();
  });

  it('redirects to the via-stripped URL and plants the cookie', () => {
    const response = captureAffiliateVia(
      makeRequest('https://app.teable.ai/space?via=ariex&x=1', { host: 'app.teable.ai' })
    );
    expect(response?.status).toBe(307);
    expect(response?.headers.get('location')).toBe('https://app.teable.ai/space?x=1');
    expect(response?.cookies.get(AFFILIATE_COOKIE_NAME)?.value).toBe('ariex');
  });

  it('derives the cookie Domain from the Host header, not nextUrl (self-hosted Next builds nextUrl from the bind address)', () => {
    const response = captureAffiliateVia(
      makeRequest('http://localhost:3000/?via=ariex', { host: 'app.teable.ai' })
    );
    const cookie = response?.cookies.get(AFFILIATE_COOKIE_NAME);
    expect(cookie?.domain).toBe('.teable.ai');
    // A widened production cookie is always Secure, even when nextUrl says http.
    expect(cookie?.secure).toBe(true);
  });

  it('prefers the first x-forwarded-host entry and strips the port', () => {
    const response = captureAffiliateVia(
      makeRequest('http://localhost:3000/?via=ariex', {
        host: 'localhost:3000',
        'x-forwarded-host': 'app.teable.cn:443, internal-lb',
      })
    );
    expect(response?.cookies.get(AFFILIATE_COOKIE_NAME)?.domain).toBe('.teable.cn');
  });

  it('falls back to PUBLIC_ORIGIN when no header carries a production host', () => {
    vi.stubEnv('PUBLIC_ORIGIN', 'https://app.teable.ai');
    const response = captureAffiliateVia(
      makeRequest('http://localhost:3000/?via=ariex', { host: 'teable-app.svc.cluster.local' })
    );
    expect(response?.cookies.get(AFFILIATE_COOKIE_NAME)?.domain).toBe('.teable.ai');
  });

  it('lets a production host in the headers win over PUBLIC_ORIGIN', () => {
    vi.stubEnv('PUBLIC_ORIGIN', 'https://app.teable.ai');
    const response = captureAffiliateVia(
      makeRequest('http://localhost:3000/?via=ariex', {
        host: 'localhost:3000',
        'x-forwarded-host': 'app.teable.cn',
      })
    );
    expect(response?.cookies.get(AFFILIATE_COOKIE_NAME)?.domain).toBe('.teable.cn');
  });

  it('stays host-only off the production apex domains', () => {
    const response = captureAffiliateVia(
      makeRequest('http://localhost:3000/?via=ariex', { host: 'localhost:3000' })
    );
    const cookie = response?.cookies.get(AFFILIATE_COOKIE_NAME);
    expect(cookie?.value).toBe('ariex');
    expect(cookie?.domain).toBeUndefined();
    expect(cookie?.secure).toBeFalsy();
  });

  it('keeps first-touch: an existing cookie is never overwritten', () => {
    const response = captureAffiliateVia(
      makeRequest('https://app.teable.ai/?via=second', {
        host: 'app.teable.ai',
        cookie: `${AFFILIATE_COOKIE_NAME}=first`,
      })
    );
    expect(response?.status).toBe(307);
    expect(response?.cookies.get(AFFILIATE_COOKIE_NAME)).toBeUndefined();
  });
});
