import { describe, expect, it } from 'vitest';

import { mapTimeZoneToPg } from './TimeZonePgMapping';

describe('TimeZonePgMapping', () => {
  describe('mapTimeZoneToPg', () => {
    it('converts lowercase utc to uppercase UTC', () => {
      expect(mapTimeZoneToPg('utc')).toBe('UTC');
    });

    it('preserves IANA timezone names', () => {
      expect(mapTimeZoneToPg('Asia/Shanghai')).toBe('Asia/Shanghai');
      expect(mapTimeZoneToPg('America/New_York')).toBe('America/New_York');
      expect(mapTimeZoneToPg('Europe/London')).toBe('Europe/London');
    });

    it('preserves Etc/UTC format', () => {
      expect(mapTimeZoneToPg('Etc/UTC')).toBe('Etc/UTC');
    });

    it('preserves Etc/GMT offset formats', () => {
      expect(mapTimeZoneToPg('Etc/GMT+8')).toBe('Etc/GMT+8');
      expect(mapTimeZoneToPg('Etc/GMT-5')).toBe('Etc/GMT-5');
    });
  });
});
