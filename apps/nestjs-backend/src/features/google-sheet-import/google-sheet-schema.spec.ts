import { FieldType } from '@teable/core';
import { columnIndexToLetter } from './google-sheet-api.client';
import { convertCellValue, inferColumnPlans } from './google-sheet-schema';
import type { IGoogleGridCell } from './google-sheet.types';

const text = (value: string): IGoogleGridCell => ({
  effectiveValue: { stringValue: value },
  formattedValue: value,
});
const num = (value: number, format?: string): IGoogleGridCell => ({
  effectiveValue: { numberValue: value },
  formattedValue: String(value),
  ...(format ? { effectiveFormat: { numberFormat: { type: format } } } : {}),
});
const bool = (value: boolean): IGoogleGridCell => ({
  effectiveValue: { boolValue: value },
  formattedValue: value ? 'TRUE' : 'FALSE',
});
const empty = (): IGoogleGridCell => ({});

describe('columnIndexToLetter', () => {
  it('maps 1-based indexes to A1 letters', () => {
    expect(columnIndexToLetter(1)).toBe('A');
    expect(columnIndexToLetter(26)).toBe('Z');
    expect(columnIndexToLetter(27)).toBe('AA');
    expect(columnIndexToLetter(52)).toBe('AZ');
    expect(columnIndexToLetter(703)).toBe('AAA');
  });
});

describe('inferColumnPlans', () => {
  it('infers one typed column per used grid column', () => {
    const { plans } = inferColumnPlans([
      [text('Name'), text('Age'), text('Signed up'), text('Active'), text('Notes')],
      [text('Ada'), num(36), num(45000, 'DATE'), bool(true), text('line1\nline2')],
      [text('Bob'), num(41), num(45010, 'DATE'), bool(false), text('plain')],
    ]);
    expect(plans.map((plan) => plan.type)).toEqual([
      FieldType.SingleLineText,
      FieldType.Number,
      FieldType.Date,
      FieldType.Checkbox,
      FieldType.LongText,
    ]);
    expect(plans.map((plan) => plan.name)).toEqual(['Name', 'Age', 'Signed up', 'Active', 'Notes']);
  });

  it('degrades mixed columns to text and dedupes header names', () => {
    const { plans } = inferColumnPlans([
      [text('Col'), text('Col'), empty()],
      [num(1), text('one'), text('data')],
    ]);
    expect(plans).toHaveLength(3);
    expect(plans[0].type).toBe(FieldType.Number);
    expect(plans[1].type).toBe(FieldType.SingleLineText);
    expect(plans[0].name).not.toBe(plans[1].name);
    // Headerless third column with data gets a fallback name.
    expect(plans[2].name).toBe('Field 3');
  });

  it('marks TIME columns as timeOnly text', () => {
    const { plans } = inferColumnPlans([[text('At')], [num(0.5, 'TIME')], [num(0.75, 'TIME')]]);
    expect(plans[0].type).toBe(FieldType.SingleLineText);
    expect(plans[0].timeOnly).toBe(true);
  });

  it('drops trailing empty columns but keeps interior ones', () => {
    const { plans } = inferColumnPlans([
      [text('A'), empty(), text('C'), empty(), empty()],
      [text('1'), empty(), text('3')],
    ]);
    expect(plans.map((plan) => plan.name)).toEqual(['A', 'Field 2', 'C']);
  });

  it('returns no columns for an empty sheet', () => {
    expect(inferColumnPlans([])).toEqual({ plans: [], headerOffset: 0 });
    expect(inferColumnPlans([[empty(), empty()]]).plans).toEqual([]);
  });

  it('skips leading blank rows and reports the header offset', () => {
    const { plans, headerOffset } = inferColumnPlans([
      [empty(), empty()],
      [],
      [text('Name'), text('Age')],
      [text('Ada'), num(36)],
    ]);
    expect(headerOffset).toBe(2);
    expect(plans.map((plan) => plan.name)).toEqual(['Name', 'Age']);
    expect(plans[1].type).toBe(FieldType.Number);
  });

  it('degrades a Checkbox primary column to text (v2 rejects checkbox primaries)', () => {
    const { plans } = inferColumnPlans([
      [text('Done'), text('Task')],
      [bool(true), text('a')],
      [bool(false), text('b')],
    ]);
    expect(plans[0].type).toBe(FieldType.SingleLineText);
    expect(plans[1].type).toBe(FieldType.SingleLineText);
  });

  it('marks DATE_TIME columns as hasTime', () => {
    const { plans } = inferColumnPlans([
      [text('When'), text('Day')],
      [num(45010.5, 'DATE_TIME'), num(45010, 'DATE')],
    ]);
    expect(plans[0].type).toBe(FieldType.Date);
    expect(plans[0].hasTime).toBe(true);
    expect(plans[1].hasTime).toBeUndefined();
  });
});

describe('convertCellValue', () => {
  const dateColumn = { index: 0, name: 'd', type: FieldType.Date } as const;
  const numberColumn = { index: 0, name: 'n', type: FieldType.Number } as const;
  const checkboxColumn = { index: 0, name: 'c', type: FieldType.Checkbox } as const;
  const textColumn = { index: 0, name: 't', type: FieldType.SingleLineText } as const;

  it('converts Google day serials to ISO dates', () => {
    // Serial 25569 is 1970-01-01 in the 1899-12-30 epoch.
    expect(convertCellValue(25569, dateColumn)).toEqual({ value: '1970-01-01T00:00:00.000Z' });
    expect(convertCellValue(25569.5, dateColumn)).toEqual({ value: '1970-01-01T12:00:00.000Z' });
  });

  it('converts TIME serial fractions to HH:mm:ss text without a 24h wrap', () => {
    const timeColumn = { ...textColumn, timeOnly: true };
    expect(convertCellValue(0.5, timeColumn)).toEqual({ value: '12:00:00' });
    expect(convertCellValue(0.75, timeColumn)).toEqual({ value: '18:00:00' });
    // Durations ([h]:mm:ss) also report as TIME: 1.25 days = 30 hours.
    expect(convertCellValue(1.25, timeColumn)).toEqual({ value: '30:00:00' });
  });

  it('imports checkboxes as true-or-empty', () => {
    expect(convertCellValue(true, checkboxColumn)).toEqual({ value: true });
    expect(convertCellValue(false, checkboxColumn)).toEqual({});
    expect(convertCellValue('yes', checkboxColumn)).toEqual({ dropped: true });
  });

  it('parses numeric strings and drops the unparsable', () => {
    expect(convertCellValue(' 42 ', numberColumn)).toEqual({ value: 42 });
    expect(convertCellValue('n/a', numberColumn)).toEqual({ dropped: true });
  });

  it('keeps empty cells empty, including whitespace-only strings', () => {
    expect(convertCellValue(undefined, textColumn)).toEqual({});
    expect(convertCellValue('', numberColumn)).toEqual({});
    // A lone space must not become the number 0.
    expect(convertCellValue(' ', numberColumn)).toEqual({});
  });

  it('drops unparsable strings in date columns instead of letting typecast null them', () => {
    expect(convertCellValue('2023-01-05', dateColumn)).toEqual({ value: '2023-01-05' });
    expect(convertCellValue('TBD', dateColumn)).toEqual({ dropped: true });
  });
});
