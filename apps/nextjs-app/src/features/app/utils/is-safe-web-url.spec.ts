import { isSafeWebUrl } from './is-safe-web-url';

describe('isSafeWebUrl', () => {
  it('accepts http and https', () => {
    expect(isSafeWebUrl('https://example.com')).toBe(true);
    expect(isSafeWebUrl('http://localhost:3000/path?q=1')).toBe(true);
  });

  it('rejects script-bearing and exotic schemes', () => {
    // All of these pass zod's .url() — parseability is not safety.
    expect(isSafeWebUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeWebUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isSafeWebUrl('vbscript:x')).toBe(false);
    expect(isSafeWebUrl('file:///etc/passwd')).toBe(false);
  });

  it('rejects unparseable input', () => {
    expect(isSafeWebUrl('not a url')).toBe(false);
    expect(isSafeWebUrl('')).toBe(false);
  });
});
