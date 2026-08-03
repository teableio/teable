import { describe, expect, it } from 'vitest';

import { DateTimeFormatting, TimeFormatting } from './DateTimeFormatting';

describe('DateTimeFormatting', () => {
  it('accepts valid formatting values', () => {
    const result = DateTimeFormatting.create({
      date: 'YYYY-MM-DD',
      time: TimeFormatting.Hour24,
      timeZone: 'utc',
    });
    result._unsafeUnwrap();
  });

  it('rejects invalid time zone', () => {
    const result = DateTimeFormatting.create({
      date: 'YYYY-MM-DD',
      time: TimeFormatting.Hour12,
      timeZone: 'invalid/zone',
    });
    result._unsafeUnwrapErr();
  });

  it('supports defaults and dto mapping', () => {
    const defaultFormatting = DateTimeFormatting.default();
    const dto = defaultFormatting.toDto();
    expect(dto.date).toBeTruthy();
    expect(dto.time).toBe(TimeFormatting.None);
    expect(dto.timeZone).toBeTruthy();

    const custom = DateTimeFormatting.create({
      date: 'YYYY/MM/DD',
      time: TimeFormatting.Hour24,
      timeZone: 'utc',
    });
    const customValue = custom._unsafeUnwrap();
    expect(customValue.equals(customValue)).toBe(true);
    expect(customValue.toDto()).toEqual({
      date: 'YYYY/MM/DD',
      time: TimeFormatting.Hour24,
      timeZone: 'utc',
    });
  });
});
