import { describe, it, expect, afterEach } from 'vitest';
import { getSsrfSafeAgents } from './ssrf-guard';

describe('getSsrfSafeAgents', () => {
  afterEach(() => {
    delete process.env.TEABLE_SSRF_PROTECTION_DISABLED;
  });

  it('should return both agents', () => {
    const agents = getSsrfSafeAgents();
    expect(agents.httpAgent).toBeDefined();
    expect(agents.httpsAgent).toBeDefined();
  });

  it('should return empty object when SSRF protection is disabled', () => {
    process.env.TEABLE_SSRF_PROTECTION_DISABLED = 'true';
    expect(getSsrfSafeAgents()).toEqual({});
  });

  it('should return same cached object', () => {
    expect(getSsrfSafeAgents()).toBe(getSsrfSafeAgents());
  });
});
