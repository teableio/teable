/* eslint-disable sonarjs/no-duplicate-string */
import { TableDomain } from '@teable/core';
import { beforeEach, describe, expect, it } from 'vitest';

import type { IFieldSelectName } from '../../../features/record/query-builder/field-select.type';
import type { ISelectFormulaConversionContext } from '../../../features/record/query-builder/sql-conversion.visitor';
import { SelectQueryPostgres } from './select-query.postgres';

describe('SelectQueryPostgres unit-aware date helpers', () => {
  const query = new SelectQueryPostgres();
  const mockTable = new TableDomain({
    id: 'tblMock',
    name: 'Mock Table',
    dbTableName: 'mock_table',
    lastModifiedTime: '1970-01-01T00:00:00.000Z',
    fields: [],
  });

  const createTimezoneContext = (timeZone: string): ISelectFormulaConversionContext => ({
    table: mockTable,
    selectionMap: new Map<string, IFieldSelectName>(),
    timeZone,
  });

  describe('timezone-aware wrappers', () => {
    let tzQuery: SelectQueryPostgres;

    beforeEach(() => {
      tzQuery = new SelectQueryPostgres();
      tzQuery.setContext(createTimezoneContext('Asia/Shanghai'));
    });

    it('datestr wraps timezone-adjusted expressions before casting', () => {
      expect(tzQuery.datestr('date_col')).toBe(
        `((date_col)::timestamptz AT TIME ZONE 'Asia/Shanghai')::date::text`
      );
    });

    it('timestr wraps timezone-adjusted expressions before casting', () => {
      expect(tzQuery.timestr('date_col')).toBe(
        `((date_col)::timestamptz AT TIME ZONE 'Asia/Shanghai')::time::text`
      );
    });

    it('workday casts after timezone normalization', () => {
      expect(tzQuery.workday('start_col', '5')).toBe(
        `((start_col)::timestamptz AT TIME ZONE 'Asia/Shanghai')::date + INTERVAL '5 days'`
      );
    });

    it('dateAdd uses timezone-normalized base expression', () => {
      expect(tzQuery.dateAdd('date_col', '2', `'day'`)).toBe(
        `(date_col)::timestamptz AT TIME ZONE 'Asia/Shanghai' + ((2)) * INTERVAL '1 day'`
      );
    });

    it('day extracts day after timezone normalization', () => {
      expect(tzQuery.day('date_col')).toBe(
        `EXTRACT(DAY FROM (date_col)::timestamptz AT TIME ZONE 'Asia/Shanghai')::int`
      );
    });

    it('datetimeFormat formats timezone-normalized timestamp', () => {
      expect(tzQuery.datetimeFormat('date_col', `'%Y'`)).toBe(
        `TO_CHAR((date_col)::timestamptz AT TIME ZONE 'Asia/Shanghai', '%Y')`
      );
    });

    it('isAfter compares timezone-normalized expressions', () => {
      expect(tzQuery.isAfter('date_a', 'date_b')).toBe(
        `(date_a)::timestamptz AT TIME ZONE 'Asia/Shanghai' > (date_b)::timestamptz AT TIME ZONE 'Asia/Shanghai'`
      );
    });

    it('isBefore compares timezone-normalized expressions', () => {
      expect(tzQuery.isBefore('date_a', 'date_b')).toBe(
        `(date_a)::timestamptz AT TIME ZONE 'Asia/Shanghai' < (date_b)::timestamptz AT TIME ZONE 'Asia/Shanghai'`
      );
    });

    it('isSame normalizes unit comparisons after timezone conversion', () => {
      expect(tzQuery.isSame('date_a', 'date_b', `'hour'`)).toBe(
        `DATE_TRUNC('hour', (date_a)::timestamptz AT TIME ZONE 'Asia/Shanghai') = DATE_TRUNC('hour', (date_b)::timestamptz AT TIME ZONE 'Asia/Shanghai')`
      );
    });

    it('hour extracts hour after timezone normalization', () => {
      expect(tzQuery.hour('date_col')).toBe(
        `EXTRACT(HOUR FROM (date_col)::timestamptz AT TIME ZONE 'Asia/Shanghai')::int`
      );
    });

    it('minute extracts minute after timezone normalization', () => {
      expect(tzQuery.minute('date_col')).toBe(
        `EXTRACT(MINUTE FROM (date_col)::timestamptz AT TIME ZONE 'Asia/Shanghai')::int`
      );
    });

    it('second extracts second after timezone normalization', () => {
      expect(tzQuery.second('date_col')).toBe(
        `EXTRACT(SECOND FROM (date_col)::timestamptz AT TIME ZONE 'Asia/Shanghai')::int`
      );
    });

    it('month extracts month after timezone normalization', () => {
      expect(tzQuery.month('date_col')).toBe(
        `EXTRACT(MONTH FROM (date_col)::timestamptz AT TIME ZONE 'Asia/Shanghai')::int`
      );
    });

    it('year extracts year after timezone normalization', () => {
      expect(tzQuery.year('date_col')).toBe(
        `EXTRACT(YEAR FROM (date_col)::timestamptz AT TIME ZONE 'Asia/Shanghai')::int`
      );
    });

    it('weekNum extracts week number after timezone normalization', () => {
      expect(tzQuery.weekNum('date_col')).toBe(
        `EXTRACT(WEEK FROM (date_col)::timestamptz AT TIME ZONE 'Asia/Shanghai')::int`
      );
    });

    it('weekday extracts day of week after timezone normalization', () => {
      expect(tzQuery.weekday('date_col')).toBe(
        `EXTRACT(DOW FROM (date_col)::timestamptz AT TIME ZONE 'Asia/Shanghai')::int`
      );
    });

    it('toNow computes epoch difference using timezone context', () => {
      expect(tzQuery.toNow('date_col')).toBe(
        `EXTRACT(EPOCH FROM ((date_col)::timestamptz AT TIME ZONE 'Asia/Shanghai' - (NOW() AT TIME ZONE 'Asia/Shanghai')))`
      );
    });

    it('datetimeDiff subtracts timezone-normalized expressions', () => {
      expect(tzQuery.datetimeDiff('start_col', 'end_col', `'day'`)).toBe(
        `(EXTRACT(EPOCH FROM ((end_col)::timestamptz AT TIME ZONE 'Asia/Shanghai' - (start_col)::timestamptz AT TIME ZONE 'Asia/Shanghai'))) / 86400`
      );
    });

    it('fromNow uses timezone-aware current timestamp', () => {
      expect(tzQuery.fromNow('date_col')).toBe(
        `EXTRACT(EPOCH FROM ((NOW() AT TIME ZONE 'Asia/Shanghai') - (date_col)::timestamptz AT TIME ZONE 'Asia/Shanghai'))`
      );
    });

    it('escapes single quotes in timezone identifiers', () => {
      const customTzQuery = new SelectQueryPostgres();
      customTzQuery.setContext(createTimezoneContext("America/St_John's"));

      expect(customTzQuery.datestr('date_col')).toBe(
        `((date_col)::timestamptz AT TIME ZONE 'America/St_John''s')::date::text`
      );
    });
  });

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
    expect(sql).toBe(`(date_col)::timestamp + (${scaled}) * INTERVAL '1 ${unit}'`);
  });

  const datetimeDiffCases: Array<{ literal: string; expected: string }> = [
    {
      literal: 'millisecond',
      expected: '(EXTRACT(EPOCH FROM ((date_end)::timestamp - (date_start)::timestamp))) * 1000',
    },
    {
      literal: 'milliseconds',
      expected: '(EXTRACT(EPOCH FROM ((date_end)::timestamp - (date_start)::timestamp))) * 1000',
    },
    {
      literal: 'ms',
      expected: '(EXTRACT(EPOCH FROM ((date_end)::timestamp - (date_start)::timestamp))) * 1000',
    },
    {
      literal: 'second',
      expected: '(EXTRACT(EPOCH FROM ((date_end)::timestamp - (date_start)::timestamp)))',
    },
    {
      literal: 'seconds',
      expected: '(EXTRACT(EPOCH FROM ((date_end)::timestamp - (date_start)::timestamp)))',
    },
    {
      literal: 'sec',
      expected: '(EXTRACT(EPOCH FROM ((date_end)::timestamp - (date_start)::timestamp)))',
    },
    {
      literal: 'secs',
      expected: '(EXTRACT(EPOCH FROM ((date_end)::timestamp - (date_start)::timestamp)))',
    },
    {
      literal: 'minute',
      expected: '(EXTRACT(EPOCH FROM ((date_end)::timestamp - (date_start)::timestamp))) / 60',
    },
    {
      literal: 'minutes',
      expected: '(EXTRACT(EPOCH FROM ((date_end)::timestamp - (date_start)::timestamp))) / 60',
    },
    {
      literal: 'min',
      expected: '(EXTRACT(EPOCH FROM ((date_end)::timestamp - (date_start)::timestamp))) / 60',
    },
    {
      literal: 'mins',
      expected: '(EXTRACT(EPOCH FROM ((date_end)::timestamp - (date_start)::timestamp))) / 60',
    },
    {
      literal: 'hour',
      expected: '(EXTRACT(EPOCH FROM ((date_end)::timestamp - (date_start)::timestamp))) / 3600',
    },
    {
      literal: 'hours',
      expected: '(EXTRACT(EPOCH FROM ((date_end)::timestamp - (date_start)::timestamp))) / 3600',
    },
    {
      literal: 'hr',
      expected: '(EXTRACT(EPOCH FROM ((date_end)::timestamp - (date_start)::timestamp))) / 3600',
    },
    {
      literal: 'hrs',
      expected: '(EXTRACT(EPOCH FROM ((date_end)::timestamp - (date_start)::timestamp))) / 3600',
    },
    {
      literal: 'week',
      expected:
        '(EXTRACT(EPOCH FROM ((date_end)::timestamp - (date_start)::timestamp))) / (86400 * 7)',
    },
    {
      literal: 'weeks',
      expected:
        '(EXTRACT(EPOCH FROM ((date_end)::timestamp - (date_start)::timestamp))) / (86400 * 7)',
    },
    {
      literal: 'day',
      expected: '(EXTRACT(EPOCH FROM ((date_end)::timestamp - (date_start)::timestamp))) / 86400',
    },
    {
      literal: 'days',
      expected: '(EXTRACT(EPOCH FROM ((date_end)::timestamp - (date_start)::timestamp))) / 86400',
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
      `DATE_TRUNC('${expectedUnit}', (date_a)::timestamp) = DATE_TRUNC('${expectedUnit}', (date_b)::timestamp)`
    );
  });

  describe('numeric aggregate rewrites', () => {
    it('sum rewrites multiple params to addition with numeric coercion', () => {
      const sql = query.sum(['column_a', 'column_b', '10']);
      expect(sql).toBe(
        "(COALESCE(NULLIF(REGEXP_REPLACE((column_a)::text, '[^0-9.+-]', '', 'g'), '')::double precision, 0) + COALESCE(NULLIF(REGEXP_REPLACE((column_b)::text, '[^0-9.+-]', '', 'g'), '')::double precision, 0) + COALESCE(NULLIF(REGEXP_REPLACE((10)::text, '[^0-9.+-]', '', 'g'), '')::double precision, 0))"
      );
    });

    it('average divides the rewritten sum by parameter count', () => {
      const sql = query.average(['column_a', '10']);
      expect(sql).toBe(
        "((COALESCE(NULLIF(REGEXP_REPLACE((column_a)::text, '[^0-9.+-]', '', 'g'), '')::double precision, 0) + COALESCE(NULLIF(REGEXP_REPLACE((10)::text, '[^0-9.+-]', '', 'g'), '')::double precision, 0))) / 2"
      );
    });
  });
});
