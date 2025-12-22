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
    expect(custom.isOk()).toBe(true);
    if (custom.isErr()) return;
    expect(custom.value.equals(custom.value)).toBe(true);
    expect(custom.value.toDto()).toEqual({
      date: 'YYYY/MM/DD',
      time: TimeFormatting.Hour24,
      timeZone: 'utc',
    });
  });
});
