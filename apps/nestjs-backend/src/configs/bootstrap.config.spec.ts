import { parseTrustProxy } from './bootstrap.config';

describe('parseTrustProxy', () => {
  it('defaults to private-network proxies when unset or blank', () => {
    expect(parseTrustProxy(undefined)).toBe('loopback, linklocal, uniquelocal');
    expect(parseTrustProxy('')).toBe('loopback, linklocal, uniquelocal');
    expect(parseTrustProxy('  ')).toBe('loopback, linklocal, uniquelocal');
  });

  it('parses booleans', () => {
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('false')).toBe(false);
  });

  it('parses hop counts', () => {
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('0')).toBe(0);
  });

  it('passes through IP/CIDR/preset lists', () => {
    expect(parseTrustProxy('10.0.0.0/8, 172.16.0.0/12')).toBe('10.0.0.0/8, 172.16.0.0/12');
    expect(parseTrustProxy('loopback')).toBe('loopback');
  });
});
