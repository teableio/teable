import { describe, expect, it } from 'vitest';

import { DateTimeFormatting, TimeFormatting } from './DateTimeFormatting';

describe('DateTimeFormatting', () => {
  it('accepts valid formatting values', () => {
    const result = DateTimeFormatting.create({
      date: 'YYYY-MM-DD',
      time: TimeFormatting.Hour24,
      timeZone: 'utc',
    });
    expect(result.isOk()).toBe(true);
  });

  it('rejects invalid time zone', () => {
    const result = DateTimeFormatting.create({
      date: 'YYYY-MM-DD',
      time: TimeFormatting.Hour12,
      timeZone: 'invalid/zone',
    });
    expect(result.isErr()).toBe(true);
  });
});
