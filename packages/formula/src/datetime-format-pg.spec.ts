import { describe, expect, it } from 'vitest';

import {
  DATETIME_FORMAT_TOKEN_TO_POSTGRES,
  buildDatetimeFormatSql,
  buildDatetimeParseGuardRegex,
  expandLocalizedDatetimeFormat,
  hasDatetimeTimezoneToken,
  normalizeDatetimeFormatExpression,
} from './datetime-format-pg';

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
});
