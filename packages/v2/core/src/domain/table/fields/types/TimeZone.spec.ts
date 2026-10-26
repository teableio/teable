import { describe, expect, it } from 'vitest';

import { DateTimeFormatting } from './DateTimeFormatting';
import { TIME_ZONE_LIST, TimeZone, timeZoneValueSchema } from './TimeZone';

describe('TimeZone outside the curated list', () => {
  it('accepts a valid IANA zone the runtime recognizes, e.g. Europe/Kyiv', () => {
    expect(TIME_ZONE_LIST).not.toContain('Europe/Kyiv');
    expect(TimeZone.create('Europe/Kyiv')._unsafeUnwrap().toString()).toBe('Europe/Kyiv');
    expect(timeZoneValueSchema.parse('Europe/Kyiv')).toBe('Europe/Kyiv');
    expect(
      DateTimeFormatting.create({ date: 'YYYY-MM-DD', time: 'None', timeZone: 'Europe/Kyiv' })
        ._unsafeUnwrap()
        .toDto().timeZone
    ).toBe('Europe/Kyiv');
  });

  it('rejects unknown zones with the localized validation error', () => {
    const error = TimeZone.create('Not/AZone')._unsafeUnwrapErr();
    expect(error.message).toBe('Invalid TimeZone: Not/AZone');
    expect(error.localization).toEqual({
      i18nKey: 'httpErrors.field.timeZoneInvalid',
      context: { timeZone: 'Not/AZone' },
    });
    expect(timeZoneValueSchema.safeParse('Not/AZone').success).toBe(false);
  });

  it('rejects numeric offsets and non-strings that Postgres would misread', () => {
    for (const raw of ['+05:00', '-0300', '', ' Europe/Kyiv', 42, null]) {
      expect(TimeZone.create(raw).isErr()).toBe(true);
    }
  });
});
