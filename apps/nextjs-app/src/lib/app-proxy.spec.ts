/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server';
import { APP_ROBOTS_TAG, proxy } from './app-proxy';

const makeRequest = (url: string) => new NextRequest(url, { headers: { host: 'app.teable.ai' } });

describe('app proxy SEO isolation', () => {
  it.each([
    'https://app.teable.ai/',
    'https://app.teable.ai/auth/login',
    'https://app.teable.ai/setting/personal-access-token',
  ])('marks %s as noindex without changing routing behavior', (url) => {
    const response = proxy(makeRequest(url));

    expect(response.headers.get('X-Robots-Tag')).toBe(APP_ROBOTS_TAG);
    expect(response.headers.get('location')).toBeNull();
  });

  it('leaves query parameters untouched', () => {
    const response = proxy(makeRequest('https://app.teable.ai/space?x=1'));

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('X-Robots-Tag')).toBe(APP_ROBOTS_TAG);
  });
});
