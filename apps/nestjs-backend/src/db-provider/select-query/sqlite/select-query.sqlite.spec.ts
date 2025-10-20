/* eslint-disable sonarjs/no-duplicate-string */
import { describe, expect, it } from 'vitest';

import { SelectQuerySqlite } from './select-query.sqlite';

describe('SelectQuerySqlite unit-aware date helpers', () => {
  const query = new SelectQuerySqlite();

  const dateAddCases: Array<{ literal: string; unit: string; factor: number }> = [
    { literal: 'millisecond', unit: 'seconds', factor: 0.001 },
    { literal: 'milliseconds', unit: 'seconds', factor: 0.001 },
    { literal: 'ms', unit: 'seconds', factor: 0.001 },
    { literal: 'second', unit: 'seconds', factor: 1 },
    { literal: 'seconds', unit: 'seconds', factor: 1 },
    { literal: 'sec', unit: 'seconds', factor: 1 },
    { literal: 'secs', unit: 'seconds', factor: 1 },
    { literal: 'minute', unit: 'minutes', factor: 1 },
    { literal: 'minutes', unit: 'minutes', factor: 1 },
    { literal: 'min', unit: 'minutes', factor: 1 },
    { literal: 'mins', unit: 'minutes', factor: 1 },
    { literal: 'hour', unit: 'hours', factor: 1 },
    { literal: 'hours', unit: 'hours', factor: 1 },
    { literal: 'hr', unit: 'hours', factor: 1 },
    { literal: 'hrs', unit: 'hours', factor: 1 },
    { literal: 'day', unit: 'days', factor: 1 },
    { literal: 'days', unit: 'days', factor: 1 },
    { literal: 'week', unit: 'days', factor: 7 },
    { literal: 'weeks', unit: 'days', factor: 7 },
    { literal: 'month', unit: 'months', factor: 1 },
    { literal: 'months', unit: 'months', factor: 1 },
    { literal: 'quarter', unit: 'months', factor: 3 },
    { literal: 'quarters', unit: 'months', factor: 3 },
    { literal: 'year', unit: 'years', factor: 1 },
    { literal: 'years', unit: 'years', factor: 1 },
  ];

  it.each(dateAddCases)(
    'dateAdd normalizes unit "%s" to SQLite modifier "%s"',
    ({ literal, unit, factor }) => {
      const sql = query.dateAdd('date_col', 'count_expr', `'${literal}'`);
      const scaled = factor === 1 ? '(count_expr)' : `(count_expr) * ${factor}`;
      expect(sql).toBe(`DATETIME(date_col, (${scaled}) || ' ${unit}')`);
    }
  );

  const datetimeDiffCases: Array<{ literal: string; expected: string }> = [
    {
      literal: 'millisecond',
      expected: '((JULIANDAY(date_end) - JULIANDAY(date_start))) * 24.0 * 60 * 60 * 1000',
    },
    {
      literal: 'milliseconds',
      expected: '((JULIANDAY(date_end) - JULIANDAY(date_start))) * 24.0 * 60 * 60 * 1000',
    },
    {
      literal: 'ms',
      expected: '((JULIANDAY(date_end) - JULIANDAY(date_start))) * 24.0 * 60 * 60 * 1000',
    },
    {
      literal: 'second',
      expected: '((JULIANDAY(date_end) - JULIANDAY(date_start))) * 24.0 * 60 * 60',
    },
    {
      literal: 'seconds',
      expected: '((JULIANDAY(date_end) - JULIANDAY(date_start))) * 24.0 * 60 * 60',
    },
    {
      literal: 'sec',
      expected: '((JULIANDAY(date_end) - JULIANDAY(date_start))) * 24.0 * 60 * 60',
    },
    {
      literal: 'secs',
      expected: '((JULIANDAY(date_end) - JULIANDAY(date_start))) * 24.0 * 60 * 60',
    },
    {
      literal: 'minute',
      expected: '((JULIANDAY(date_end) - JULIANDAY(date_start))) * 24.0 * 60',
    },
    {
      literal: 'minutes',
      expected: '((JULIANDAY(date_end) - JULIANDAY(date_start))) * 24.0 * 60',
    },
    {
      literal: 'min',
      expected: '((JULIANDAY(date_end) - JULIANDAY(date_start))) * 24.0 * 60',
    },
    {
      literal: 'mins',
      expected: '((JULIANDAY(date_end) - JULIANDAY(date_start))) * 24.0 * 60',
    },
    {
      literal: 'hour',
      expected: '((JULIANDAY(date_end) - JULIANDAY(date_start))) * 24.0',
    },
    {
      literal: 'hours',
      expected: '((JULIANDAY(date_end) - JULIANDAY(date_start))) * 24.0',
    },
    {
      literal: 'hr',
      expected: '((JULIANDAY(date_end) - JULIANDAY(date_start))) * 24.0',
    },
    {
      literal: 'hrs',
      expected: '((JULIANDAY(date_end) - JULIANDAY(date_start))) * 24.0',
    },
    {
      literal: 'week',
      expected: '((JULIANDAY(date_end) - JULIANDAY(date_start))) / 7.0',
    },
    {
      literal: 'weeks',
      expected: '((JULIANDAY(date_end) - JULIANDAY(date_start))) / 7.0',
    },
    { literal: 'day', expected: '(JULIANDAY(date_end) - JULIANDAY(date_start))' },
    { literal: 'days', expected: '(JULIANDAY(date_end) - JULIANDAY(date_start))' },
  ];

  it.each(datetimeDiffCases)('datetimeDiff normalizes unit "%s"', ({ literal, expected }) => {
    const sql = query.datetimeDiff('date_start', 'date_end', `'${literal}'`);
    expect(sql).toBe(expected);
  });

  const isSameCases: Array<{ literal: string; format: string }> = [
    { literal: 'millisecond', format: '%Y-%m-%d %H:%M:%S' },
    { literal: 'milliseconds', format: '%Y-%m-%d %H:%M:%S' },
    { literal: 'ms', format: '%Y-%m-%d %H:%M:%S' },
    { literal: 'second', format: '%Y-%m-%d %H:%M:%S' },
    { literal: 'seconds', format: '%Y-%m-%d %H:%M:%S' },
    { literal: 'sec', format: '%Y-%m-%d %H:%M:%S' },
    { literal: 'secs', format: '%Y-%m-%d %H:%M:%S' },
    { literal: 'minute', format: '%Y-%m-%d %H:%M' },
    { literal: 'minutes', format: '%Y-%m-%d %H:%M' },
    { literal: 'min', format: '%Y-%m-%d %H:%M' },
    { literal: 'mins', format: '%Y-%m-%d %H:%M' },
    { literal: 'hour', format: '%Y-%m-%d %H' },
    { literal: 'hours', format: '%Y-%m-%d %H' },
    { literal: 'hr', format: '%Y-%m-%d %H' },
    { literal: 'hrs', format: '%Y-%m-%d %H' },
    { literal: 'day', format: '%Y-%m-%d' },
    { literal: 'days', format: '%Y-%m-%d' },
    { literal: 'week', format: '%Y-%W' },
    { literal: 'weeks', format: '%Y-%W' },
    { literal: 'month', format: '%Y-%m' },
    { literal: 'months', format: '%Y-%m' },
    { literal: 'year', format: '%Y' },
    { literal: 'years', format: '%Y' },
  ];

  it.each(isSameCases)('isSame normalizes unit "%s"', ({ literal, format }) => {
    const sql = query.isSame('date_a', 'date_b', `'${literal}'`);
    expect(sql).toBe(`STRFTIME('${format}', date_a) = STRFTIME('${format}', date_b)`);
  });

  describe('numeric aggregate rewrites', () => {
    it('sum rewrites multiple params to addition with numeric coercion', () => {
      const sql = query.sum(['column_a', 'column_b', '10']);
      expect(sql).toBe(
        '(COALESCE(CAST((column_a) AS REAL), 0) + COALESCE(CAST((column_b) AS REAL), 0) + COALESCE(CAST((10) AS REAL), 0))'
      );
    });

    it('average divides the rewritten sum by parameter count', () => {
      const sql = query.average(['column_a', '10']);
      expect(sql).toBe(
        '((COALESCE(CAST((column_a) AS REAL), 0) + COALESCE(CAST((10) AS REAL), 0))) / 2'
      );
    });
  });
});
