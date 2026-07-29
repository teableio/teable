import { describe, it, expect } from 'vitest';
import { attachmentUrlSchema } from './types';

describe('attachmentUrlSchema', () => {
  it('accepts absolute http(s) URLs', () => {
    expect(attachmentUrlSchema.safeParse('https://example.com/data.csv').success).toBe(true);
    expect(attachmentUrlSchema.safeParse('http://example.com/data.csv').success).toBe(true);
  });

  it('accepts the server attachment-read path (resolved server-side)', () => {
    expect(
      attachmentUrlSchema.safeParse('/api/attachments/read/bucket/abc.csv?token=x').success
    ).toBe(true);
  });

  it('rejects arbitrary relative paths (loopback SSRF gadget)', () => {
    expect(attachmentUrlSchema.safeParse('/admin').success).toBe(false);
    expect(attachmentUrlSchema.safeParse('/internal/secret').success).toBe(false);
    // a non-read path that merely looks similar must not slip through
    expect(attachmentUrlSchema.safeParse('/api/attachments/readme').success).toBe(false);
  });

  it('rejects non-http protocols', () => {
    expect(attachmentUrlSchema.safeParse('file:///etc/passwd').success).toBe(false);
    expect(attachmentUrlSchema.safeParse('gopher://example.com/').success).toBe(false);
  });
});
