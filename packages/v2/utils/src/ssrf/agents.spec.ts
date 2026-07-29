import fetch from 'node-fetch';
import { describe, it, expect, afterEach } from 'vitest';
import { getSafeAxiosAgents, getSafeFetchAgent } from './agents';

describe('getSafeAxiosAgents', () => {
  afterEach(() => {
    delete process.env.TEABLE_SSRF_PROTECTION_DISABLED;
  });

  it('should return both agents', () => {
    const agents = getSafeAxiosAgents();
    expect(agents.httpAgent).toBeDefined();
    expect(agents.httpsAgent).toBeDefined();
  });

  it('should return empty object when SSRF protection is disabled', () => {
    process.env.TEABLE_SSRF_PROTECTION_DISABLED = 'true';
    expect(getSafeAxiosAgents()).toEqual({});
  });

  it('should return same cached object', () => {
    expect(getSafeAxiosAgents()).toBe(getSafeAxiosAgents());
  });
});

describe('getSafeFetchAgent', () => {
  afterEach(() => {
    delete process.env.TEABLE_SSRF_PROTECTION_DISABLED;
  });

  it('returns undefined when SSRF protection is disabled (env opt-out parity)', () => {
    process.env.TEABLE_SSRF_PROTECTION_DISABLED = 'true';
    expect(getSafeFetchAgent()).toBeUndefined();
  });

  it('returns a per-url agent selector that picks the protocol-matching agent', () => {
    const selector = getSafeFetchAgent();
    expect(typeof selector).toBe('function');

    const httpAgent = selector!(new URL('http://example.com/file.csv'));
    const httpsAgent = selector!(new URL('https://example.com/file.csv'));

    expect((httpAgent as unknown as { protocol: string }).protocol).toBe('http:');
    expect((httpsAgent as unknown as { protocol: string }).protocol).toBe('https:');
  });

  it('rejects a fetch to a loopback address (filtered before connecting)', async () => {
    const agent = getSafeFetchAgent();
    // request-filtering-agent rejects loopback at connection time, so this
    // never actually connects — no hang on the closed port.
    await expect(fetch('http://127.0.0.1:9/teapot', { agent })).rejects.toThrow();
  });

  it('rejects a fetch to the link-local cloud-metadata address', async () => {
    const agent = getSafeFetchAgent();
    await expect(fetch('http://169.254.169.254/latest/meta-data/', { agent })).rejects.toThrow();
  });
});
