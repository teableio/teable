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

export const renderDateValue = (date: Dayjs, pattern: string, timeZone: string): string =>
  date.tz(timeZone).format(pattern);
