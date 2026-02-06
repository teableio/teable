/* eslint-disable sonarjs/no-duplicate-string */
import {
  DateTimeFormatting,
  FieldId,
  FieldName,
  LookupOptions,
  NumberFormatting,
  NumberFormattingType,
  TableId,
  TimeFormatting,
  createDateField,
  createNumberField,
  createSingleLineTextField,
  LookupField,
} from '@teable/v2-core';
import { describe, expect, it } from 'vitest';

import {
  formatDatetimeStringSql,
  formatFieldValueAsStringSql,
  formatNumberStringSql,
} from './FieldFormattingSql';

const createNumberFormatting = (type: NumberFormattingType) =>
  NumberFormatting.create({ type, precision: 2, symbol: '€' })._unsafeUnwrap();

const createDateFormatting = () =>
  DateTimeFormatting.create({
    date: 'YYYY/MM/DD',
    time: TimeFormatting.Hour24,
    timeZone: 'UTC',
  })._unsafeUnwrap();

const createNumberFieldWithFormatting = (formatting: NumberFormatting) =>
  createNumberField({
    id: FieldId.generate()._unsafeUnwrap(),
    name: FieldName.create('Amount')._unsafeUnwrap(),
    formatting,
  })._unsafeUnwrap();

const createDateFieldWithFormatting = (formatting: DateTimeFormatting) =>
  createDateField({
    id: FieldId.generate()._unsafeUnwrap(),
    name: FieldName.create('Due')._unsafeUnwrap(),
    formatting,
  })._unsafeUnwrap();

describe('FieldFormattingSql', () => {
  it.each([
    {
      type: NumberFormattingType.Decimal,
      expected: "trim(to_char((value)::numeric, '999999990D00'))",
    },
    {
      type: NumberFormattingType.Percent,
      expected: "trim(to_char(((value)::numeric * 100), '999999990D00')) || '%'",
    },
    {
      type: NumberFormattingType.Currency,
      expected: "'€' || trim(to_char((value)::numeric, '999999990D00'))",
    },
  ])('formats number SQL for $type', ({ type, expected }) => {
    const formatting = createNumberFormatting(type);
    expect(formatNumberStringSql('value', formatting)).toBe(expected);
  });

  it('formats datetime SQL with timezone and mask', () => {
    const formatting = createDateFormatting();
    expect(formatDatetimeStringSql('value', formatting)).toBe(
      "TO_CHAR((value)::timestamptz AT TIME ZONE 'UTC', 'YYYY/MM/DD HH24:MI')"
    );
  });

  it('formats field value SQL for number fields', () => {
    const field = createNumberFieldWithFormatting(
      createNumberFormatting(NumberFormattingType.Decimal)
    );
    expect(formatFieldValueAsStringSql(field, 'value', 'number')).toBe(
      "trim(to_char((value)::numeric, '999999990D00'))"
    );
  });

  it('formats field value SQL for datetime fields', () => {
    const field = createDateFieldWithFormatting(createDateFormatting());
    expect(formatFieldValueAsStringSql(field, 'value', 'datetime')).toBe(
      "TO_CHAR((value)::timestamptz AT TIME ZONE 'UTC', 'YYYY/MM/DD HH24:MI')"
    );
  });

  it('returns undefined when value type does not match formatting', () => {
    const field = createNumberFieldWithFormatting(
      createNumberFormatting(NumberFormattingType.Decimal)
    );
    expect(formatFieldValueAsStringSql(field, 'value', 'datetime')).toBeUndefined();
  });

  it('formats lookup fields using inner formatting', () => {
    const numberFormatting = createNumberFormatting(NumberFormattingType.Decimal);
    const innerField = createNumberFieldWithFormatting(numberFormatting);
    const lookupOptions = {
      linkFieldId: FieldId.generate()._unsafeUnwrap().toString(),
      lookupFieldId: FieldId.generate()._unsafeUnwrap().toString(),
      foreignTableId: TableId.generate()._unsafeUnwrap().toString(),
    };
    const lookupResult = LookupOptions.create(lookupOptions)
      .andThen((options) =>
        LookupField.create({
          id: FieldId.generate()._unsafeUnwrap(),
          name: FieldName.create('LookupAmount')._unsafeUnwrap(),
          innerField,
          lookupOptions: options,
        })
      )
      ._unsafeUnwrap();

    expect(formatFieldValueAsStringSql(lookupResult, 'value', 'number')).toBe(
      "trim(to_char((value)::numeric, '999999990D00'))"
    );
  });

  it('returns undefined when field has no formatting', () => {
    const field = createSingleLineTextField({
      id: FieldId.generate()._unsafeUnwrap(),
      name: FieldName.create('Text')._unsafeUnwrap(),
    })._unsafeUnwrap();

    expect(formatFieldValueAsStringSql(field, 'value', 'string')).toBeUndefined();
  });

  it('returns undefined when field is undefined', () => {
    expect(formatFieldValueAsStringSql(undefined, 'value', 'string')).toBeUndefined();
  });

  it('formats datetime with no time component', () => {
    const formatting = DateTimeFormatting.create({
      date: 'YYYY/MM/DD',
      time: TimeFormatting.None,
      timeZone: 'UTC',
    })._unsafeUnwrap();

    expect(formatDatetimeStringSql('value', formatting)).toBe(
      "TO_CHAR((value)::timestamptz AT TIME ZONE 'UTC', 'YYYY/MM/DD')"
    );
  });

  it('formats datetime with 12-hour time', () => {
    const formatting = DateTimeFormatting.create({
      date: 'YYYY/MM/DD',
      time: TimeFormatting.Hour12,
      timeZone: 'UTC',
    })._unsafeUnwrap();

    expect(formatDatetimeStringSql('value', formatting)).toBe(
      "TO_CHAR((value)::timestamptz AT TIME ZONE 'UTC', 'YYYY/MM/DD HH12:MI AM')"
    );
  });

  it('formats datetime with timezone override', () => {
    const formatting = createDateFormatting();
    expect(formatDatetimeStringSql('value', formatting, 'Asia/Shanghai')).toBe(
      "TO_CHAR((value)::timestamptz AT TIME ZONE 'Asia/Shanghai', 'YYYY/MM/DD HH24:MI')"
    );
  });

  it.each([
    { format: 'M/D/YYYY', expected: 'FMMM/FMDD/YYYY' },
    { format: 'D/M/YYYY', expected: 'FMDD/FMMM/YYYY' },
    { format: 'YYYY/MM/DD', expected: 'YYYY/MM/DD' },
    { format: 'YYYY-MM', expected: 'YYYY-MM' },
    { format: 'MM-DD', expected: 'MM-DD' },
    { format: 'YYYY', expected: 'YYYY' },
    { format: 'MM', expected: 'MM' },
    { format: 'DD', expected: 'DD' },
    { format: 'unknown', expected: 'YYYY-MM-DD' },
  ])('formats date mask $format correctly', ({ format, expected }) => {
    const formatting = DateTimeFormatting.create({
      date: format,
      time: TimeFormatting.None,
      timeZone: 'UTC',
    })._unsafeUnwrap();

    expect(formatDatetimeStringSql('value', formatting)).toBe(
      `TO_CHAR((value)::timestamptz AT TIME ZONE 'UTC', '${expected}')`
    );
  });

  it('formats number with zero precision', () => {
    const formatting = NumberFormatting.create({
      type: NumberFormattingType.Decimal,
      precision: 0,
    })._unsafeUnwrap();

    expect(formatNumberStringSql('value', formatting)).toBe(
      "trim(to_char((value)::numeric, '999999990'))"
    );
  });
});
