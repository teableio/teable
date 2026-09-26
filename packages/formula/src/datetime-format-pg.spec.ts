import { describe, expect, it } from 'vitest';

import {
  DATETIME_FORMAT_TOKEN_TO_POSTGRES,
  buildDatetimeFormatSql,
  buildDatetimeParseGuardRegex,
  expandLocalizedDatetimeFormat,
  hasDatetimeTimezoneToken,
  normalizeDatetimeFormatExpression,
  type IDatetimeFormatWriter,
} from './datetime-format-pg';

class DatetimeAllocationExceeded extends Error {}

const limitedWriter = (maxBytes: number): IDatetimeFormatWriter => {
  const writer: IDatetimeFormatWriter = {
    bytes: (value) => Buffer.byteLength(value, 'utf8'),
    allocate: (bytes) => {
      if (bytes > maxBytes) throw new DatetimeAllocationExceeded();
    },
    sql: (parts, ...values) => {
      const strings = values.map(String);
      writer.allocate(
        parts.reduce((bytes, part) => bytes + writer.bytes(part), 0) +
          strings.reduce((bytes, value) => bytes + writer.bytes(value), 0)
      );
      let result = parts[0];
      for (let i = 0; i < strings.length; i++) result += strings[i] + parts[i + 1];
      return result;
    },
    join(values, separator) {
      this.allocate(
        values.reduce((bytes, value) => bytes + this.bytes(value), 0) +
          Math.max(0, values.length - 1) * this.bytes(separator)
      );
      return values.join(separator);
    },
  };
  return writer;
};

describe('datetime-format-pg', () => {
  it('keeps the MMYYYY token sequence type-safe and intact for PostgreSQL parsing', () => {
    expect(DATETIME_FORMAT_TOKEN_TO_POSTGRES.MM).toBe('MM');
    expect(DATETIME_FORMAT_TOKEN_TO_POSTGRES.YYYY).toBe('YYYY');
    expect(normalizeDatetimeFormatExpression("'MMYYYY'")).toBe("'MMYYYY'");
  });

  it('builds SQL fragments for composite format literals without collapsing adjacent tokens', () => {
    expect(buildDatetimeFormatSql('event_time', "'MMYYYY'")).toBe(
      "TO_CHAR(event_time, 'MM') || TO_CHAR(event_time, 'YYYY')"
    );
  });

  it('expands localized tokens before scanning specifiers', () => {
    expect(expandLocalizedDatetimeFormat('LLL')).toBe('MMMM D, YYYY h:mm A');
  });

  it('detects timezone-bearing format tokens only when they are real specifiers', () => {
    expect(hasDatetimeTimezoneToken("'YYYY-MM-DD Z'")).toBe(true);
    expect(hasDatetimeTimezoneToken("'MMYYYY'")).toBe(false);
    expect(hasDatetimeTimezoneToken('format_column')).toBeNull();
  });

  it('builds a guard regex for MMYYYY reparsing', () => {
    expect(buildDatetimeParseGuardRegex("'MMYYYY'")).toBe('^\\d{2}\\d{4}.*$');
  });

  it('allows trailing characters after a valid custom-format prefix', () => {
    const guardRegex = new RegExp(buildDatetimeParseGuardRegex("'YYYY-MM-DD'") as string);

    expect(guardRegex.test('2024-06-15T00:00:00Z')).toBe(true);
    expect(guardRegex.test('2024-06-15 xxx')).toBe(true);
    expect(guardRegex.test('abc')).toBe(false);
  });

  it('bounds repeated datetime SQL before constructing the combined fragment', () => {
    const datetimeSql = 'event_time'.repeat(20);
    expect(() =>
      buildDatetimeFormatSql(datetimeSql, "'MMYYYY'", undefined, limitedWriter(300))
    ).toThrow(DatetimeAllocationExceeded);
    expect(buildDatetimeFormatSql(datetimeSql, "'MMYYYY'", undefined, limitedWriter(1024))).toBe(
      buildDatetimeFormatSql(datetimeSql, "'MMYYYY'")
    );
  });

  it('bounds localized expansion in UTF-8 without splitting surrogate pairs', () => {
    const expected = 'MMMM D, YYYY😀';
    const bytes = Buffer.byteLength(expected, 'utf8');
    expect(() => expandLocalizedDatetimeFormat('LL😀', limitedWriter(bytes - 1))).toThrow(
      DatetimeAllocationExceeded
    );
    expect(expandLocalizedDatetimeFormat('LL😀', limitedWriter(bytes))).toBe(expected);
  });

  it('preserves quoted Unicode formatting, timezone tokens and parse guards with a writer', () => {
    const writer = limitedWriter(8192);
    const format = "'YYYY-MM-DD 😀 Z'";
    expect(buildDatetimeFormatSql('event_time', format, "'+08:00'", writer)).toBe(
      buildDatetimeFormatSql('event_time', format, "'+08:00'")
    );
    expect(normalizeDatetimeFormatExpression(format, writer)).toBe(
      normalizeDatetimeFormatExpression(format)
    );
    expect(hasDatetimeTimezoneToken(format, writer)).toBe(true);
    expect(buildDatetimeParseGuardRegex("'YYYY-MM-DD😀'", writer)).toBe(
      buildDatetimeParseGuardRegex("'YYYY-MM-DD😀'")
    );
  });
});
