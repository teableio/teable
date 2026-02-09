import { describe, expect, it } from 'vitest';

import { getDefaultDatetimeParsePattern } from './default-datetime-parse-pattern';

describe('default datetime parse pattern', () => {
  it('accepts 1-digit hour in ISO-like datetimes', () => {
    const pattern = new RegExp(getDefaultDatetimeParsePattern());
    expect(pattern.test('2025-11-01 8:40')).toBe(true);
    expect(pattern.test('2025-11-01 08:40')).toBe(true);
  });

  it('accepts single-digit month and day', () => {
    const pattern = new RegExp(getDefaultDatetimeParsePattern());
    // Single-digit month
    expect(pattern.test('2026-9-15')).toBe(true);
    expect(pattern.test('2026-1-15')).toBe(true);
    // Single-digit day
    expect(pattern.test('2026-09-5')).toBe(true);
    expect(pattern.test('2026-12-1')).toBe(true);
    // Both single-digit
    expect(pattern.test('2026-9-5')).toBe(true);
    expect(pattern.test('2026-1-1')).toBe(true);
    // Double-digit (still works)
    expect(pattern.test('2026-09-15')).toBe(true);
    expect(pattern.test('2026-12-31')).toBe(true);
  });

  it('treats blank strings as invalid', () => {
    const pattern = new RegExp(getDefaultDatetimeParsePattern());
    expect(pattern.test('')).toBe(false);
    expect(pattern.test(' ')).toBe(false);
  });
});
