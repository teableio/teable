import { normalizeHref } from './LinkToolbar';

describe('normalizeHref', () => {
  it('keeps http(s) and mailto links as typed', () => {
    expect(normalizeHref(' https://teable.ai/x ')).toBe('https://teable.ai/x');
    expect(normalizeHref('HTTP://a.io')).toBe('HTTP://a.io');
    expect(normalizeHref('mailto:a@b.co')).toBe('mailto:a@b.co');
  });

  it('adds https to a bare domain', () => {
    expect(normalizeHref('teable.ai')).toBe('https://teable.ai');
  });

  it('refuses other schemes and empty input', () => {
    expect(normalizeHref('javascript:alert(1)')).toBeNull();
    expect(normalizeHref('data:text/html,x')).toBeNull();
    expect(normalizeHref('   ')).toBeNull();
  });
});
