/* eslint-disable @typescript-eslint/no-explicit-any */
import type { IDatetimeFormatting } from './datetime';
import {
  datetimeFormattingSchema,
  DateFormattingPreset,
  formatDateToString,
  TimeFormatting,
} from './datetime';

const timeZone = 'utc';

describe('formatDateToString', () => {
  it('should correctly format date string', () => {
    const dateStr = '2023-07-12T14:30:00Z';
    const formatting: IDatetimeFormatting = {
      time: TimeFormatting.None,
      date: DateFormattingPreset.European,
      timeZone: timeZone,
    };
    expect(formatDateToString(dateStr, formatting)).toBe('12/7/2023');
  });

  it('should return empty string for null', () => {
    const dateStr = null;
    expect(
      formatDateToString(dateStr as any, {
        time: TimeFormatting.None,
        date: DateFormattingPreset.European,
        timeZone: timeZone,
      })
    ).toBe('');
  });

  it('should correctly format date and time string', () => {
    const dateStr = '2023-07-12T14:30:00Z';
    const formatting: IDatetimeFormatting = {
      date: DateFormattingPreset.ISO,
      time: TimeFormatting.Hour24,
      timeZone: timeZone,
    };
    expect(formatDateToString(dateStr, formatting)).toBe('2023-07-12 14:30');
  });

  it('should validate time zone', () => {
    expect(
      datetimeFormattingSchema.safeParse({
        date: DateFormattingPreset.ISO,
        time: TimeFormatting.Hour24,
        timeZone: timeZone,
      }).success
    ).toBeTruthy();

    expect(
      datetimeFormattingSchema.safeParse({
        date: DateFormattingPreset.ISO,
        time: TimeFormatting.Hour24,
        timeZone: 'xxx/xxx',
      }).success
    ).toBeFalsy();
  });
});
