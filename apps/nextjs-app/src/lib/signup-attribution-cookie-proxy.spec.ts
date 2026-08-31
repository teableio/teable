/**
 * @vitest-environment node
 *
 * node, not happy-dom: happy-dom's Request strips fetch-spec forbidden headers
 * (host, cookie), which this suite must set to simulate proxied requests.
 */
import { SIGNUP_ATTRIBUTION_COOKIE_NAME } from '@teable/core';
import { NextRequest, NextResponse } from 'next/server';
import { captureSignupAttribution } from './signup-attribution-cookie-proxy';

const makeRequest = (url: string, headers: Record<string, string> = {}) =>
  new NextRequest(url, { headers });

const capture = (url: string, headers: Record<string, string> = {}) => {
  const response = NextResponse.next();
  captureSignupAttribution(makeRequest(url, headers), response);
  return response;
};

describe('captureSignupAttribution', () => {
  beforeEach(() => {
    vi.stubEnv('PUBLIC_ORIGIN', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does nothing when the URL carries no whitelisted params', () => {
    const response = capture('https://app.teable.ai/?foo=bar');
    expect(response.cookies.get(SIGNUP_ATTRIBUTION_COOKIE_NAME)).toBeUndefined();
  });

  it('plants a JSON cookie with only the whitelisted params, URL untouched', () => {
    const response = capture(
      'https://app.teable.ai/?utm_source=facebook&utm_campaign=aug&fbclid=abc123&evil=dropme',
      { host: 'app.teable.ai' }
    );
    const cookie = response.cookies.get(SIGNUP_ATTRIBUTION_COOKIE_NAME);
    expect(JSON.parse(cookie!.value)).toEqual({
      utm_source: 'facebook',
      utm_campaign: 'aug',
      fbclid: 'abc123',
    });
    // Unlike the affiliate ?via= flow there is no redirect/URL cleanup —
    // posthog-js and gtag still need the params client-side.
    expect(response.status).toBe(200);
  });

  it('is first-touch: an existing cookie is never overwritten', () => {
    const response = NextResponse.next();
    captureSignupAttribution(
      makeRequest('https://app.teable.ai/?utm_source=second-touch', {
        host: 'app.teable.ai',
        cookie: `${SIGNUP_ATTRIBUTION_COOKIE_NAME}=${encodeURIComponent('{"utm_source":"first"}')}`,
      }),
      response
    );
    expect(response.cookies.get(SIGNUP_ATTRIBUTION_COOKIE_NAME)).toBeUndefined();
  });

  it('sheds low-priority params to keep the payload under the aggregate cap, click ids first', () => {
    // All 12 whitelisted keys at the per-value cap ≈ 6 KB serialized — far
    // over the ceiling; shedding must keep the priority head, drop the tail.
    const long = (c: string) => c.repeat(500);
    const query = new URLSearchParams({
      utm_source: 'facebook',
      utm_medium: long('m'),
      utm_campaign: long('c'),
      utm_term: long('t'),
      utm_content: long('n'),
      ref: long('r'),
      cta_id: long('x'),
      landing_cta_id: long('l'),
      gclid: long('g'),
      gbraid: long('b'),
      wbraid: long('w'),
      fbclid: long('f'),
    });
    const response = capture(`https://app.teable.ai/?${query.toString()}`, {
      host: 'app.teable.ai',
    });
    const cookie = response.cookies.get(SIGNUP_ATTRIBUTION_COOKIE_NAME);
    const payload = JSON.parse(cookie!.value);
    // Click ids and coarse dimensions survive; long-tail labels are shed whole.
    expect(payload.gclid).toBeDefined();
    expect(payload.fbclid).toBeDefined();
    expect(payload.utm_source).toBe('facebook');
    expect(payload.cta_id).toBeUndefined();
    expect(payload.landing_cta_id).toBeUndefined();
    expect(encodeURIComponent(cookie!.value).length).toBeLessThanOrEqual(3000);
  });

  it('bounds by ENCODED size — CJK values expand ~9x when percent-encoded', () => {
    const cjk = '增长循环计划口径冻结'.repeat(50); // 500 chars ≈ 4.5 KB encoded
    const query = new URLSearchParams({
      gclid: 'g-123',
      utm_source: 'wechat',
      utm_campaign: cjk,
      utm_term: cjk,
    });
    const response = capture(`https://app.teable.ai/?${query.toString()}`, {
      host: 'app.teable.ai',
    });
    const cookie = response.cookies.get(SIGNUP_ATTRIBUTION_COOKIE_NAME);
    const payload = JSON.parse(cookie!.value);
    expect(payload.gclid).toBe('g-123');
    expect(payload.utm_source).toBe('wechat');
    // At most one CJK monster fits under the encoded bound; never both.
    expect([payload.utm_campaign, payload.utm_term].filter(Boolean).length).toBeLessThanOrEqual(1);
    expect(encodeURIComponent(cookie!.value).length).toBeLessThanOrEqual(3000);
  });

  it('derives the cookie Domain from the Host header (self-hosted Next builds nextUrl from the bind address)', () => {
    const response = capture('http://localhost:3000/?utm_source=x', { host: 'app.teable.ai' });
    const cookie = response.cookies.get(SIGNUP_ATTRIBUTION_COOKIE_NAME);
    expect(cookie?.domain).toBe('.teable.ai');
    expect(cookie?.secure).toBe(true);
    expect(cookie?.httpOnly).toBe(true);
  });

  it('degrades to a host-only cookie off the production apexes', () => {
    const response = capture('http://localhost:3000/?utm_source=x', { host: 'localhost:3000' });
    const cookie = response.cookies.get(SIGNUP_ATTRIBUTION_COOKIE_NAME);
    expect(cookie).toBeDefined();
    expect(cookie?.domain).toBeUndefined();
  });
});
