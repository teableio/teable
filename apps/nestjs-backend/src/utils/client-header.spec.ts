import { describe, expect, it } from 'vitest';
import { formatClientHeader, parseClientHeader } from './client-header';

describe('client header', () => {
  it('parses name/version', () => {
    expect(parseClientHeader('mobile/0.1.0')).toEqual({ name: 'mobile', version: '0.1.0' });
    expect(parseClientHeader(' mobile/1.2.3-beta+7 ')).toEqual({
      name: 'mobile',
      version: '1.2.3-beta+7',
    });
    expect(parseClientHeader(['mobile/0.1.0', 'other/1'])).toEqual({
      name: 'mobile',
      version: '0.1.0',
    });
    expect(formatClientHeader('mobile/0.1.0')).toBe('mobile/0.1.0');
  });

  it('ignores missing or malformed values', () => {
    for (const value of [
      undefined,
      '',
      'mobile',
      '/1.0',
      'Mobile/1.0',
      'mobile/1 0',
      'a'.repeat(40) + '/1',
    ]) {
      expect(parseClientHeader(value)).toBeUndefined();
      expect(formatClientHeader(value)).toBeUndefined();
    }
  });
});
