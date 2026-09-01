/* eslint-disable regexp/use-ignore-case */
import type { DateField } from '../types/DateField';

const normalizeTimeZone = (timeZone: string) =>
  timeZone.toLowerCase() === 'utc' ? 'UTC' : timeZone;

const timeZoneFormatterCache = new Map<string, Intl.DateTimeFormat>();

const DATE_COMPONENT_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?(?:[zZ]|[+-]\d{2}:\d{2})?$/;

const CANONICAL_ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const getTimeZoneFormatter = (timeZone: string): Intl.DateTimeFormat => {
  const normalizedTimeZone = normalizeTimeZone(timeZone);
  const cachedFormatter = timeZoneFormatterCache.get(normalizedTimeZone);
  if (cachedFormatter) return cachedFormatter;

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: normalizedTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  timeZoneFormatterCache.set(normalizedTimeZone, formatter);
  return formatter;
};

const getTimeZoneOffsetMinutes = (date: Date, timeZone: string): number => {
  const formatter = getTimeZoneFormatter(timeZone);
  const parts = formatter.formatToParts(date);
  const values: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      values[part.type] = Number(part.value);
    }
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

type DateComponents = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
};

const parseDateComponents = (value: string): DateComponents | undefined => {
  const match = value.match(DATE_COMPONENT_PATTERN);
  if (!match) return undefined;

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4] ?? 0),
    minute: Number(match[5] ?? 0),
    second: Number(match[6] ?? 0),
    millisecond: Number((match[7] ?? '0').padEnd(3, '0')),
  };
};

const isExactUtcDate = (date: Date, components: DateComponents): boolean =>
  !isNaN(date.getTime()) &&
  date.getUTCFullYear() === components.year &&
  date.getUTCMonth() === components.month - 1 &&
  date.getUTCDate() === components.day &&
  date.getUTCHours() === components.hour &&
  date.getUTCMinutes() === components.minute &&
  date.getUTCSeconds() === components.second &&
  date.getUTCMilliseconds() === components.millisecond;

const isValidCalendarComponents = (components: DateComponents): boolean => {
  // Validate the local/wall-clock components themselves. Date.UTC and Date.parse both
  // roll invalid day/time values (2026-02-30 → 2026-03-02), so callers must reject before
  // converting timezones or offsets.
  const probe = new Date(
    Date.UTC(
      components.year,
      components.month - 1,
      components.day,
      components.hour,
      components.minute,
      components.second,
      components.millisecond
    )
  );
  return isExactUtcDate(probe, components);
};

const parseDateStringWithTimeZone = (value: string, timeZone: string): string | undefined => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const components = parseDateComponents(trimmed);
  if (!components) {
    const parsed = new Date(trimmed);
    return isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
  }

  if (!isValidCalendarComponents(components)) {
    return undefined;
  }

  const hasTimeZoneSuffix = /[zZ]|[+-]\d{2}:\d{2}$/.test(trimmed);
  if (hasTimeZoneSuffix) {
    const parsed = new Date(trimmed);
    return isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
  }

  const utcBase = new Date(
    Date.UTC(
      components.year,
      components.month - 1,
      components.day,
      components.hour,
      components.minute,
      components.second,
      components.millisecond
    )
  );

  const normalizedTimeZone = normalizeTimeZone(timeZone);
  if (normalizedTimeZone === 'UTC') return utcBase.toISOString();

  const offsetMinutes = getTimeZoneOffsetMinutes(utcBase, normalizedTimeZone);
  const adjusted = new Date(utcBase.getTime() - offsetMinutes * 60000);
  return adjusted.toISOString();
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

  // Fast path for values already in the canonical form this parser emits.
  // Round-trip equality rejects rolled-over invalid dates (2026-02-30 → March).
  if (CANONICAL_ISO_UTC_PATTERN.test(trimmed)) {
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime()) && parsed.toISOString() === trimmed) {
      return trimmed;
    }
  }

  const timeZone = field.formatting().timeZone().toString();
  return parseDateStringWithTimeZone(trimmed, timeZone);
};
