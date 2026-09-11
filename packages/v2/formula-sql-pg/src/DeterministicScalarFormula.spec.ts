import { describe, expect, it } from 'vitest';

import { analyzeDeterministicScalarFormula } from './DeterministicScalarFormula';

const analyze = (expression: string) =>
  analyzeDeterministicScalarFormula(expression, {
    isStoredDateField: (id) => id === 'fldcccccccccccccccc',
  })._unsafeUnwrap();

describe('deterministic scalar formula analysis', () => {
  it.each([
    'UPPER(TRIM({fldaaaaaaaaaaaaaaaa}))',
    'IF({fldbbbbbbbbbbbbbbbb}, "NOW() is just text", "no")',
    'DATE_ADD({fldcccccccccccccccc}, 1, "day")',
    'ROUND(ABS(-1.23), 1)',
    'LOWER("escaped \\" TODAY() ")',
    'IF(1 = 0, ERROR("zero"), "ok")',
    'YEAR({fldcccccccccccccccc})',
    'YEAR("2024-01-01")',
    'IF(TRUE, {fldcccccccccccccccc}, "2024-01-01")',
    'IF(TRUE, {fldcccccccccccccccc}, BLANK())',
    '{fldcccccccccccccccc} < "2024-01-01"',
    'YEAR(DATE_ADD({fldcccccccccccccccc}, 1, "day"))',
  ])('allows bounded scalar syntax: %s', (expression) => {
    expect(analyze(expression)).toBeDefined();
  });

  it.each([
    'NOW()',
    'YEAR("now")',
    'YEAR({fldaaaaaaaaaaaaaaaa})',
    'DATE_ADD("today", 1, "day")',
    'TODAY()',
    'FROMNOW({fldcccccccccccccccc})',
    'LAST_MODIFIED_TIME()',
    'CREATED_TIME()',
    'RECORD_ID()',
    'IF(TRUE, "ok", NOW())',
    'IF(TRUE, "ok", UNKNOWN_FUNCTION())',
    'SUM(TEXTSPLIT("1,2", ","))',
    'REGEXP_REPLACE("abc", "a", "b")',
    'REPT("a", 100000)',
    'WORKDAY("2024-01-01", 100)',
  ])('retains statement boundary for %s', (expression) => {
    expect(analyze(expression)).toBeUndefined();
  });

  it.each([
    'IF(TRUE, {fldcccccccccccccccc}, "now")',
    'IF(TRUE, {fldcccccccccccccccc}, {fldaaaaaaaaaaaaaaaa})',
    'IF(TRUE, "today", IF(TRUE, {fldcccccccccccccccc}, BLANK()))',
    '{fldcccccccccccccccc} < "now"',
    '"today" = DATE_ADD({fldcccccccccccccccc}, 1, "day")',
    'IF(TRUE, DATE_ADD("2024-01-01", 1, "day"), "now")',
    'IS_ERROR(IF(TRUE, {fldcccccccccccccccc}, "today"))',
    'SWITCH(1, 1, {fldcccccccccccccccc}, {fldcccccccccccccccc}) < "now"',
  ])('rejects implicit relative timestamp coercion: %s', (expression) => {
    expect(analyze(expression)).toBeUndefined();
  });

  it('requires schema proof for implicit date positions and fixed datetime destinations', () => {
    expect(
      analyzeDeterministicScalarFormula('IF(TRUE, {fldaaaaaaaaaaaaaaaa}, "now")')._unsafeUnwrap()
    ).toBeUndefined();
    expect(
      analyzeDeterministicScalarFormula('IF(TRUE, {fldaaaaaaaaaaaaaaaa}, "now")', {
        isStoredDateField: () => false,
      })._unsafeUnwrap()
    ).toBeDefined();
    expect(
      analyzeDeterministicScalarFormula('"now"', { requireDateResult: true })._unsafeUnwrap()
    ).toBeUndefined();
    expect(
      analyzeDeterministicScalarFormula('"2024-01-01"', { requireDateResult: true })._unsafeUnwrap()
    ).toBeDefined();
  });

  it('extracts only real references and does not mistake strings for calls', () => {
    expect(
      analyze('"{fldbbbbbbbbbbbbbbbb} NOW()" & {fldaaaaaaaaaaaaaaaa}')?.fieldReferences
    ).toEqual(['fldaaaaaaaaaaaaaaaa']);
    expect(analyze('upper("yes")')).toBeDefined();
  });

  it('bounds function nesting, total calls, source size and syntax cost', () => {
    expect(analyze('UPPER(LOWER(TRIM(UPPER(LOWER("a")))))')).toBeUndefined();
    expect(analyze(Array.from({ length: 9 }, () => 'ABS(1)').join('+'))).toBeUndefined();
    expect(analyze(`"${'x'.repeat(257)}"`)).toBeUndefined();
    expect(analyzeDeterministicScalarFormula('IF(').isErr()).toBe(true);
  });
});
