import { DateFormattingPreset, type DateTimeFormatting, TimeFormatting } from '@teable/v2-core';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

type IDateSearchUnit = 'year' | 'month' | 'day' | 'minute';

export interface IDateSearchRange {
  start: string;
  end: string;
}

const dateSearchPatterns: Array<{ pattern: RegExp; format: string; unit: IDateSearchUnit }> = [
  { pattern: /^\d{4}$/, format: 'YYYY', unit: 'year' },
  { pattern: /^\d{4}-\d{2}$/, format: 'YYYY-MM', unit: 'month' },
  { pattern: /^\d{4}-\d{2}-\d{2}$/, format: 'YYYY-MM-DD', unit: 'day' },
  { pattern: /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/, format: 'YYYY-MM-DD HH:mm', unit: 'minute' },
];

const isUnitAllowed = (unit: IDateSearchUnit, formatting?: DateTimeFormatting): boolean => {
  const dateFormat = formatting?.date() ?? DateFormattingPreset.ISO;
  const hasTime = formatting != null && formatting.time() !== TimeFormatting.None;

  switch (unit) {
    case 'year':
      return true;
    case 'month':
      return dateFormat !== DateFormattingPreset.Y;
    case 'day':
      return dateFormat !== DateFormattingPreset.Y && dateFormat !== DateFormattingPreset.YM;
    case 'minute':
      return hasTime;
    default:
      return false;
  }
};

export const getDateSearchRange = (
  rawSearchValue: string,
  formatting?: DateTimeFormatting
): IDateSearchRange | null => {
  const searchValue = rawSearchValue.trim();
  if (!searchValue) {
    return null;
  }

  const timeZone = formatting?.timeZone().toString() ?? 'UTC';

  for (const candidate of dateSearchPatterns) {
    if (!candidate.pattern.test(searchValue) || !isUnitAllowed(candidate.unit, formatting)) {
      continue;
    }

    const normalizedSearchValue =
      candidate.unit === 'minute' ? searchValue.replace('T', ' ') : searchValue;
    const parsed = dayjs.tz(normalizedSearchValue, candidate.format, timeZone);
    if (!parsed.isValid() || parsed.format(candidate.format) !== normalizedSearchValue) {
      continue;
    }

    const start = parsed.startOf(candidate.unit);
    const end = start.add(1, candidate.unit);

    return {
      start: start.toISOString(),
      end: end.toISOString(),
    };
  }

  return null;
};
