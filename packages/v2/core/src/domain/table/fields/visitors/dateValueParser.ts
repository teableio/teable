/* eslint-disable regexp/use-ignore-case */
import type { DateField } from '../types/DateField';

const normalizeTimeZone = (timeZone: string) =>
  timeZone.toLowerCase() === 'utc' ? 'UTC' : timeZone;

const getTimeZoneOffsetMinutes = (date: Date, timeZone: string): number => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: normalizeTimeZone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const values: Record<string, number> = {};
  for (const part of parts) {
    if (part.type === 'literal') continue;
    values[part.type] = Number(part.value);
  }

  const utcTime = Date.UTC(
    values.year,
    (values.month ?? 1) - 1,
    values.day ?? 1,
    values.hour ?? 0,
    values.minute ?? 0,
    values.second ?? 0
  );
  return (utcTime - date.getTime()) / 60000;
};

const parseDateStringWithTimeZone = (value: string, timeZone: string): string | undefined => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const hasTimeZoneSuffix = /[zZ]|[+-]\d{2}:\d{2}$/.test(trimmed);
  if (hasTimeZoneSuffix) {
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  const match = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/
  );
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4] ?? 0);
    const minute = Number(match[5] ?? 0);
    const second = Number(match[6] ?? 0);
    const millisecond = Number((match[7] ?? '0').padEnd(3, '0'));
    const utcBase = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
    const offsetMinutes = getTimeZoneOffsetMinutes(utcBase, timeZone);
    const adjusted = new Date(utcBase.getTime() - offsetMinutes * 60000);
    return adjusted.toISOString();
  }

  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }

  return undefined;
};

export const parseDateValue = (field: DateField, value: unknown): string | null | undefined => {
  if (value == null) return null;

  if (value instanceof Date) {
    return isNaN(value.getTime()) ? undefined : value.toISOString();
  }

  if (typeof value === 'number') {
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
  }

  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Support "now" keyword for current timestamp
  if (trimmed === 'now') {
    return new Date().toISOString();
  }

  const timeZone = field.formatting().timeZone().toString();
  return parseDateStringWithTimeZone(trimmed, timeZone);
};
