import { describe, expect, it, vi } from 'vitest';

import { FieldId } from '../FieldId';
import { FieldName } from '../FieldName';
import { DateField } from '../types/DateField';
import { DateTimeFormatting } from '../types/DateTimeFormatting';
import { parseDateValue } from './dateValueParser';

const createFieldId = (seed: string) =>
  FieldId.create(`fld${seed.padEnd(16, '0').slice(0, 16)}`)._unsafeUnwrap();
const createFieldName = (name: string) => FieldName.create(name)._unsafeUnwrap();

const createDateField = (timeZone: string) =>
  DateField.create({
    id: createFieldId('date'),
    name: createFieldName(`Date ${timeZone}`),
    formatting: DateTimeFormatting.create({
      date: 'YYYY-MM-DD',
      time: 'None',
      timeZone,
    })._unsafeUnwrap(),
  })._unsafeUnwrap();

describe('parseDateValue', () => {
  it('parses UTC date-only and local datetime values without constructing a formatter', () => {
    const field = createDateField('utc');
    const formatterSpy = vi.spyOn(Intl, 'DateTimeFormat');

    expect(parseDateValue(field, '2024-01-15')).toBe('2024-01-15T00:00:00.000Z');
    expect(parseDateValue(field, '2024-01-15T10:30:45')).toBe('2024-01-15T10:30:45.000Z');
    expect(formatterSpy).not.toHaveBeenCalled();

    formatterSpy.mockRestore();
  });

  it.each([
    ['2024-01-15T10:30:45.1', '2024-01-15T10:30:45.100Z'],
    ['2024-01-15T10:30:45.12', '2024-01-15T10:30:45.120Z'],
    ['2024-01-15T10:30:45.123', '2024-01-15T10:30:45.123Z'],
  ])('preserves millisecond precision for UTC value %s', (input, expected) => {
    expect(parseDateValue(createDateField('utc'), input)).toBe(expected);
  });

  it('uses explicit offsets directly regardless of the field timezone', () => {
    const field = createDateField('America/New_York');
    const formatterSpy = vi.spyOn(Intl, 'DateTimeFormat');

    expect(parseDateValue(field, '2024-07-15T10:30:45.12+08:00')).toBe('2024-07-15T02:30:45.120Z');
    expect(parseDateValue(field, '2024-07-15T10:30:45.123Z')).toBe('2024-07-15T10:30:45.123Z');
    expect(formatterSpy).not.toHaveBeenCalled();

    formatterSpy.mockRestore();
  });

  it('interprets date-only values in a non-UTC field timezone', () => {
    const field = createDateField('Asia/Singapore');

    expect(parseDateValue(field, '2024-01-15')).toBe('2024-01-14T16:00:00.000Z');
  });

  it('respects daylight-saving offsets in winter and summer', () => {
    const field = createDateField('America/New_York');

    expect(parseDateValue(field, '2024-01-15T10:30:00')).toBe('2024-01-15T15:30:00.000Z');
    expect(parseDateValue(field, '2024-07-15T10:30:00')).toBe('2024-07-15T14:30:00.000Z');
  });

  it('reuses the formatter for repeated values in the same timezone', () => {
    const field = createDateField('Pacific/Honolulu');
    const OriginalDateTimeFormat = Intl.DateTimeFormat;
    const formatterSpy = vi
      .spyOn(Intl, 'DateTimeFormat')
      .mockImplementation(function (locales, options) {
        return new OriginalDateTimeFormat(locales, options);
      });

    expect(parseDateValue(field, '2024-01-15T10:30:00')).toBe('2024-01-15T20:30:00.000Z');
    expect(parseDateValue(field, '2024-01-16T10:30:00')).toBe('2024-01-16T20:30:00.000Z');
    expect(formatterSpy).toHaveBeenCalledTimes(1);

    formatterSpy.mockRestore();
  });
});
