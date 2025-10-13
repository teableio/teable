/* eslint-disable sonarjs/no-duplicate-string */
import { describe, expect, it } from 'vitest';

import { SelectQueryPostgres } from './select-query.postgres';

describe('SelectQueryPostgres unit-aware date helpers', () => {
  const query = new SelectQueryPostgres();

  const dateAddCases: Array<{ literal: string; unit: string; factor: number }> = [
    { literal: 'millisecond', unit: 'millisecond', factor: 1 },
    { literal: 'milliseconds', unit: 'millisecond', factor: 1 },
    { literal: 'ms', unit: 'millisecond', factor: 1 },
    { literal: 'second', unit: 'second', factor: 1 },
    { literal: 'seconds', unit: 'second', factor: 1 },
    { literal: 'sec', unit: 'second', factor: 1 },
    { literal: 'secs', unit: 'second', factor: 1 },
    { literal: 'minute', unit: 'minute', factor: 1 },
    { literal: 'minutes', unit: 'minute', factor: 1 },
    { literal: 'min', unit: 'minute', factor: 1 },
    { literal: 'mins', unit: 'minute', factor: 1 },
    { literal: 'hour', unit: 'hour', factor: 1 },
    { literal: 'hours', unit: 'hour', factor: 1 },
    { literal: 'hr', unit: 'hour', factor: 1 },
    { literal: 'hrs', unit: 'hour', factor: 1 },
    { literal: 'day', unit: 'day', factor: 1 },
    { literal: 'days', unit: 'day', factor: 1 },
    { literal: 'week', unit: 'week', factor: 1 },
    { literal: 'weeks', unit: 'week', factor: 1 },
    { literal: 'month', unit: 'month', factor: 1 },
    { literal: 'months', unit: 'month', factor: 1 },
    { literal: 'quarter', unit: 'month', factor: 3 },
    { literal: 'quarters', unit: 'month', factor: 3 },
    { literal: 'year', unit: 'year', factor: 1 },
    { literal: 'years', unit: 'year', factor: 1 },
  ];

  it.each(dateAddCases)('dateAdd normalizes unit "%s" to "%s"', ({ literal, unit, factor }) => {
    const sql = query.dateAdd('date_col', 'count_expr', `'${literal}'`);
    const scaled = factor === 1 ? '(count_expr)' : `(count_expr) * ${factor}`;
    expect(sql).toBe(`date_col::timestamp + (${scaled}) * INTERVAL '1 ${unit}'`);
  });

  const datetimeDiffCases: Array<{ literal: string; expected: string }> = [
    {
      literal: 'millisecond',
      expected: '(EXTRACT(EPOCH FROM (date_end::timestamp - date_start::timestamp))) * 1000',
    },
    {
      literal: 'milliseconds',
      expected: '(EXTRACT(EPOCH FROM (date_end::timestamp - date_start::timestamp))) * 1000',
    },
    {
      literal: 'ms',
      expected: '(EXTRACT(EPOCH FROM (date_end::timestamp - date_start::timestamp))) * 1000',
    },
    {
      literal: 'second',
      expected: '(EXTRACT(EPOCH FROM (date_end::timestamp - date_start::timestamp)))',
    },
    {
      literal: 'seconds',
      expected: '(EXTRACT(EPOCH FROM (date_end::timestamp - date_start::timestamp)))',
    },
    {
      literal: 'sec',
      expected: '(EXTRACT(EPOCH FROM (date_end::timestamp - date_start::timestamp)))',
    },
    {
      literal: 'secs',
      expected: '(EXTRACT(EPOCH FROM (date_end::timestamp - date_start::timestamp)))',
    },
    {
      literal: 'minute',
      expected: '(EXTRACT(EPOCH FROM (date_end::timestamp - date_start::timestamp))) / 60',
    },
    {
      literal: 'minutes',
      expected: '(EXTRACT(EPOCH FROM (date_end::timestamp - date_start::timestamp))) / 60',
    },
    {
      literal: 'min',
      expected: '(EXTRACT(EPOCH FROM (date_end::timestamp - date_start::timestamp))) / 60',
    },
    {
      literal: 'mins',
      expected: '(EXTRACT(EPOCH FROM (date_end::timestamp - date_start::timestamp))) / 60',
    },
    {
      literal: 'hour',
      expected: '(EXTRACT(EPOCH FROM (date_end::timestamp - date_start::timestamp))) / 3600',
    },
    {
      literal: 'hours',
      expected: '(EXTRACT(EPOCH FROM (date_end::timestamp - date_start::timestamp))) / 3600',
    },
    {
      literal: 'hr',
      expected: '(EXTRACT(EPOCH FROM (date_end::timestamp - date_start::timestamp))) / 3600',
    },
    {
      literal: 'hrs',
      expected: '(EXTRACT(EPOCH FROM (date_end::timestamp - date_start::timestamp))) / 3600',
    },
    {
      literal: 'week',
      expected: '(EXTRACT(EPOCH FROM (date_end::timestamp - date_start::timestamp))) / (86400 * 7)',
    },
    {
      literal: 'weeks',
      expected: '(EXTRACT(EPOCH FROM (date_end::timestamp - date_start::timestamp))) / (86400 * 7)',
    },
    {
      literal: 'day',
      expected: '(EXTRACT(EPOCH FROM (date_end::timestamp - date_start::timestamp))) / 86400',
    },
    {
      literal: 'days',
      expected: '(EXTRACT(EPOCH FROM (date_end::timestamp - date_start::timestamp))) / 86400',
    },
  ];

  it.each(datetimeDiffCases)('datetimeDiff normalizes unit "%s"', ({ literal, expected }) => {
    const sql = query.datetimeDiff('date_start', 'date_end', `'${literal}'`);
    expect(sql).toBe(expected);
  });

  const isSameCases: Array<{ literal: string; expectedUnit: string }> = [
    { literal: 'millisecond', expectedUnit: 'millisecond' },
    { literal: 'milliseconds', expectedUnit: 'millisecond' },
    { literal: 'ms', expectedUnit: 'millisecond' },
    { literal: 'second', expectedUnit: 'second' },
    { literal: 'seconds', expectedUnit: 'second' },
    { literal: 'sec', expectedUnit: 'second' },
    { literal: 'secs', expectedUnit: 'second' },
    { literal: 'minute', expectedUnit: 'minute' },
    { literal: 'minutes', expectedUnit: 'minute' },
    { literal: 'min', expectedUnit: 'minute' },
    { literal: 'mins', expectedUnit: 'minute' },
    { literal: 'hour', expectedUnit: 'hour' },
    { literal: 'hours', expectedUnit: 'hour' },
    { literal: 'hr', expectedUnit: 'hour' },
    { literal: 'hrs', expectedUnit: 'hour' },
    { literal: 'day', expectedUnit: 'day' },
    { literal: 'days', expectedUnit: 'day' },
    { literal: 'week', expectedUnit: 'week' },
    { literal: 'weeks', expectedUnit: 'week' },
    { literal: 'month', expectedUnit: 'month' },
    { literal: 'months', expectedUnit: 'month' },
    { literal: 'quarter', expectedUnit: 'quarter' },
    { literal: 'quarters', expectedUnit: 'quarter' },
    { literal: 'year', expectedUnit: 'year' },
    { literal: 'years', expectedUnit: 'year' },
  ];

  it.each(isSameCases)('isSame normalizes unit "%s"', ({ literal, expectedUnit }) => {
    const sql = query.isSame('date_a', 'date_b', `'${literal}'`);
    expect(sql).toBe(
      `DATE_TRUNC('${expectedUnit}', date_a::timestamp) = DATE_TRUNC('${expectedUnit}', date_b::timestamp)`
    );
  });
});
