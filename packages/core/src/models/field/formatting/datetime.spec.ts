/* eslint-disable @typescript-eslint/no-explicit-any */
import type { IDatetimeFormatting } from './datetime';
import { DateFormattingPreset, formatDateToString, TimeFormatting } from './datetime';

const timeZone = 'America/Los_Angeles';

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
});
