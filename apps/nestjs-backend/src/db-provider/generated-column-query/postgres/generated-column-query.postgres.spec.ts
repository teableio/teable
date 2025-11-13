/* eslint-disable sonarjs/no-duplicate-string */
import { DbFieldType } from '@teable/core';
import type { TableDomain } from '@teable/core';
import { beforeEach, describe, expect, it } from 'vitest';

import type { IFormulaConversionContext } from '../../../features/record/query-builder/sql-conversion.visitor';
import { GeneratedColumnQueryPostgres } from './generated-column-query.postgres';

const castTs = (expr: string) => `(${expr})::timestamp`;

describe('GeneratedColumnQueryPostgres unit-aware helpers', () => {
  const query = new GeneratedColumnQueryPostgres();
  const stubContext: IFormulaConversionContext = {
    table: null as unknown as TableDomain,
    isGeneratedColumn: true,
  };

  beforeEach(() => {
    query.setContext(stubContext);
  });

  it('left casts expressions to text for generated columns', () => {
    expect(query.left('raw_expr', '5')).toBe(`LEFT((raw_expr)::text, 5::integer)`);
  });

  it('right casts expressions to text for generated columns', () => {
    expect(query.right('raw_expr', '4')).toBe(`RIGHT((raw_expr)::text, 4::integer)`);
  });

  it('mid casts expressions to text for generated columns', () => {
    expect(query.mid('raw_expr', '2', '5')).toBe(
      `SUBSTRING((raw_expr)::text FROM 2::integer FOR 5::integer)`
    );
  });

  it('find casts numeric search values to text expressions', () => {
    expect(query.find('202', '"text_col"')).toBe(`POSITION((202)::text IN ("text_col")::text)`);
  });

  it('find with start argument casts inputs to text expressions', () => {
    expect(query.find('202', '"text_col"', '3')).toBe(
      `POSITION((202)::text IN SUBSTRING(("text_col")::text FROM 3::integer)) + 3::integer - 1`
    );
  });

  it('search casts numeric search values before applying upper', () => {
    expect(query.search('202', '"text_col"')).toBe(
      `POSITION(UPPER((202)::text) IN UPPER(("text_col")::text))`
    );
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

  it.each(dateAddCases)(
    'dateAdd normalizes unit "%s" to "%s" for generated columns',
    ({ literal, unit, factor }) => {
      const sql = query.dateAdd('date_col', 'count_expr', `'${literal}'`);
      const scaled = factor === 1 ? '(count_expr)' : `(count_expr) * ${factor}`;
      expect(sql).toBe(`${castTs('date_col')} + (${scaled}) * INTERVAL '1 ${unit}'`);
    }
  );

  const diffSeconds = `(EXTRACT(EPOCH FROM ${castTs('date_start')} - ${castTs('date_end')}))`;
  const datetimeDiffCases: Array<{ literal: string; expected: string }> = [
    {
      literal: 'millisecond',
      expected: `${diffSeconds} * 1000`,
    },
    {
      literal: 'milliseconds',
      expected: `${diffSeconds} * 1000`,
    },
    {
      literal: 'ms',
      expected: `${diffSeconds} * 1000`,
    },
    {
      literal: 'second',
      expected: `${diffSeconds}`,
    },
    {
      literal: 'seconds',
      expected: `${diffSeconds}`,
    },
    {
      literal: 'sec',
      expected: `${diffSeconds}`,
    },
    {
      literal: 'secs',
      expected: `${diffSeconds}`,
    },
    {
      literal: 'minute',
      expected: `${diffSeconds} / 60`,
    },
    {
      literal: 'minutes',
      expected: `${diffSeconds} / 60`,
    },
    {
      literal: 'min',
      expected: `${diffSeconds} / 60`,
    },
    {
      literal: 'mins',
      expected: `${diffSeconds} / 60`,
    },
    {
      literal: 'hour',
      expected: `${diffSeconds} / 3600`,
    },
    {
      literal: 'hours',
      expected: `${diffSeconds} / 3600`,
    },
    {
      literal: 'hr',
      expected: `${diffSeconds} / 3600`,
    },
    {
      literal: 'hrs',
      expected: `${diffSeconds} / 3600`,
    },
    {
      literal: 'week',
      expected: `${diffSeconds} / (86400 * 7)`,
    },
    {
      literal: 'weeks',
      expected: `${diffSeconds} / (86400 * 7)`,
    },
    {
      literal: 'day',
      expected: `${diffSeconds} / 86400`,
    },
    {
      literal: 'days',
      expected: `${diffSeconds} / 86400`,
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
      `DATE_TRUNC('${expectedUnit}', ${castTs('date_a')}) = DATE_TRUNC('${expectedUnit}', ${castTs('date_b')})`
    );
  });

  it('coerces JSON operands before comparing to text columns', () => {
    const tableStub = {
      fieldList: [
        { dbFieldName: 'text_col', dbFieldType: DbFieldType.Text },
        { dbFieldName: 'json_col', dbFieldType: DbFieldType.Json },
      ],
    } as unknown as TableDomain;

    query.setContext({
      table: tableStub,
      isGeneratedColumn: true,
    });

    const sql = query.equal('"text_col"', '"json_col"');

    expect(sql).toContain('pg_typeof(("json_col")) = ANY');
    expect(sql).toContain('jsonb_typeof((("json_col"))::jsonb)');
    expect(sql).toContain('("text_col")::text');
  });
});
