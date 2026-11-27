import dayjs, { type Dayjs } from 'dayjs';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';

import type { DateTimeFormatting } from '../../domain/table/fields/types/DateTimeFormatting';
import {
  NumberFormattingType,
  type NumberFormatting,
} from '../../domain/table/fields/types/NumberFormatting';

dayjs.extend(utc);
dayjs.extend(timezone);

// Above MAX_SAFE_INTEGER, toFixed exposes binary digits that the JSON API never returns.
const toFixedDigits = (value: number, precision: number): string => {
  if (!Number.isFinite(value) || Math.abs(value) <= Number.MAX_SAFE_INTEGER) {
    return value.toFixed(precision);
  }
  const digits = String(value);
  const zeros = digits.includes('e') ? '' : '0'.repeat(precision);
  return zeros ? `${digits}.${zeros}` : digits;
};

type NumberValueRenderer = (value: number) => string;

// Formatting value objects are immutable. Clipboard's value visitor also reuses
// these renderers without keeping request-scoped fields alive.
const numberRenderers = new WeakMap<NumberFormatting, NumberValueRenderer>();

export const prepareNumberValueRenderer = (formatting: NumberFormatting): NumberValueRenderer => {
  const existing = numberRenderers.get(formatting);
  if (existing) return existing;
  const precision = formatting.precision().toNumber();
  const type = formatting.type();
  let render: NumberValueRenderer;
  if (type === NumberFormattingType.Currency) {
    const symbol = formatting.symbol() ?? '$';
    const currency = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
    });
    render = (value) => `${value < 0 ? '-' : ''}${symbol}${currency.format(Math.abs(value))}`;
  } else if (type === NumberFormattingType.Percent) {
    render = (value) => `${toFixedDigits(value * 100, precision)}%`;
  } else {
    render = (value) => toFixedDigits(value, precision);
  }
  numberRenderers.set(formatting, render);
  return render;
};

export const renderNumberValue = (value: number, formatting: NumberFormatting): string =>
  prepareNumberValueRenderer(formatting)(value);

export const dateDisplayPattern = (formatting: DateTimeFormatting): string =>
  formatting.time() === 'None' ? formatting.date() : `${formatting.date()} ${formatting.time()}`;

const MAX_CACHED_TIME_ZONES = 1024;
const FAST_DATE_MIN_MS = Date.UTC(100, 0, 2);
const UTC_TIME_ZONES = new Set(['utc', 'UTC', 'Etc/UTC', 'Etc/GMT', 'Etc/GMT+0', 'Etc/GMT-0']);
const timeZoneFormatters = new Map<string, Intl.DateTimeFormat | null>();

const getTimeZoneFormatter = (timeZone: string): Intl.DateTimeFormat | null => {
  const existing = timeZoneFormatters.get(timeZone);
  if (existing !== undefined) return existing;
  if (timeZoneFormatters.size >= MAX_CACHED_TIME_ZONES) {
    const oldestKey = timeZoneFormatters.keys().next().value;
    if (oldestKey !== undefined) {
      timeZoneFormatters.delete(oldestKey);
    }
  }
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    timeZoneFormatters.set(timeZone, dtf);
    return dtf;
  } catch {
    timeZoneFormatters.set(timeZone, null);
    return null;
  }
};

const resolveTimeZoneOffsetMinutes = (ms: number, timeZone: string): number | undefined => {
  if (UTC_TIME_ZONES.has(timeZone)) return 0;
  const dtf = getTimeZoneFormatter(timeZone);
  if (!dtf) return undefined;

  let year = 0;
  let month = 0;
  let day = 0;
  let hour = 0;
  let minute = 0;
  let second = 0;
  for (const part of dtf.formatToParts(ms)) {
    switch (part.type) {
      case 'year':
        year = Number(part.value);
        break;
      case 'month':
        month = Number(part.value);
        break;
      case 'day':
        day = Number(part.value);
        break;
      case 'hour':
        hour = Number(part.value) % 24;
        break;
      case 'minute':
        minute = Number(part.value);
        break;
      case 'second':
        second = Number(part.value);
        break;
    }
  }
  if (year < 100) return undefined;

  const wallMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const utcSecMs = Math.floor(ms / 1000) * 1000;
  const diffMs = wallMs - utcSecMs;
  if (diffMs % 60_000 !== 0) return undefined;
  const offsetMinutes = diffMs / 60_000;
  // dayjs/plugin/utc multiplies |offset| <= 16 by 60 (treating it as hours),
  // even for string offsets like "+00:15". Fall back for those rare historical offsets.
  if (offsetMinutes !== 0 && Math.abs(offsetMinutes) <= 16) return undefined;
  return offsetMinutes;
};

// dayjs.prototype.tz() calls uncached Date.prototype.toLocaleString() on every cell,
// and dayjs.utc(ms).utcOffset(offsetMinutes) converts through host local time (which skews
// across host DST transitions). Shift the UTC timestamp directly and attach the offset
// with keepLocalTime=true so formatting stays independent of the host process timezone.
export const renderDateValue = (date: Dayjs, pattern: string, timeZone: string): string => {
  const ms = date.valueOf();
  if (Number.isFinite(ms) && ms >= FAST_DATE_MIN_MS) {
    const offsetMinutes = resolveTimeZoneOffsetMinutes(ms, timeZone);
    if (offsetMinutes !== undefined) {
      const locale = date.locale();
      const shifted = offsetMinutes === 0 ? dayjs.utc(ms) : dayjs.utc(ms + offsetMinutes * 60_000);
      const localized = locale !== 'en' ? shifted.locale(locale) : shifted;
      const zoned = offsetMinutes === 0 ? localized : localized.utcOffset(offsetMinutes, true);
      return zoned.format(pattern);
    }
  }
  return date.tz(timeZone).format(pattern);
};
