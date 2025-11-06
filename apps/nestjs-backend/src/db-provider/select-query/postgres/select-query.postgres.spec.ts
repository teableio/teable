/* eslint-disable sonarjs/no-duplicate-string */
import { CellValueType, DbFieldType, FieldType, TableDomain } from '@teable/core';
import type { IFieldVo } from '@teable/core';
import knex from 'knex';
import { beforeEach, describe, expect, it } from 'vitest';

import { createFieldInstanceByVo } from '../../../features/field/model/factory';
import type { IFieldSelectName } from '../../../features/record/query-builder/field-select.type';
import type { ISelectFormulaConversionContext } from '../../../features/record/query-builder/sql-conversion.visitor';
import { PostgresProvider } from '../../postgres.provider';
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

  const sanitizeTimestampInput = (expr: string) => {
    const trimmed = `NULLIF(BTRIM((${expr})::text), '')`;
    return `CASE WHEN ${trimmed} IS NULL THEN NULL WHEN LOWER(${trimmed}) IN ('null', 'undefined') THEN NULL ELSE ${trimmed} END`;
  };
  const tzWrap = (expr: string, timeZone: string) => {
    const safeTz = timeZone.replace(/'/g, "''");
    return `(${sanitizeTimestampInput(expr)})::timestamptz AT TIME ZONE '${safeTz}'`;
  };
  const localWrap = (expr: string) => `(${sanitizeTimestampInput(expr)})::timestamp`;

  it('left casts expressions to text before truncation', () => {
    expect(query.left('raw_expr', '5')).toBe(`LEFT((raw_expr)::text, 5::integer)`);
  });

  it('right casts expressions to text before truncation', () => {
    expect(query.right('raw_expr', '4')).toBe(`RIGHT((raw_expr)::text, 4::integer)`);
  });

  it('mid casts expressions to text before slicing', () => {
    expect(query.mid('raw_expr', '2', '5')).toBe(
      `SUBSTRING((raw_expr)::text FROM 2::integer FOR 5::integer)`
    );
  });

  it('find casts numeric search values to text expressions', () => {
    expect(query.find('202', '"text_col"')).toBe(`POSITION((202)::text IN ("text_col")::text)`);
  });

  it('find with start argument casts inputs to text expressions', () => {
    expect(query.find('202', '"text_col"', '7')).toBe(
      `POSITION((202)::text IN SUBSTRING(("text_col")::text FROM 7::integer)) + 7::integer - 1`
    );
  });

  it('search casts numeric search values before applying upper', () => {
    expect(query.search('202', '"text_col"')).toBe(
      `POSITION(UPPER((202)::text) IN UPPER(("text_col")::text))`
    );
  });

  describe('timezone-aware wrappers', () => {
    let tzQuery: SelectQueryPostgres;
    const timeZone = 'Asia/Shanghai';
    const tz = (expr: string) => tzWrap(expr, timeZone);

    beforeEach(() => {
      tzQuery = new SelectQueryPostgres();
      tzQuery.setContext(createTimezoneContext(timeZone));
    });

    it('datestr wraps timezone-adjusted expressions before casting', () => {
      expect(tzQuery.datestr('date_col')).toBe(`(${tz('date_col')})::date::text`);
    });

    it('timestr wraps timezone-adjusted expressions before casting', () => {
      expect(tzQuery.timestr('date_col')).toBe(`(${tz('date_col')})::time::text`);
    });

    it('workday casts after timezone normalization', () => {
      expect(tzQuery.workday('start_col', '5')).toBe(
        `(${tz('start_col')})::date + INTERVAL '5 days'`
      );
    });

    it('dateAdd uses timezone-normalized base expression', () => {
      expect(tzQuery.dateAdd('date_col', '2', `'day'`)).toBe(
        `${tz('date_col')} + ((2)) * INTERVAL '1 day'`
      );
    });

    it('day extracts day after timezone normalization', () => {
      expect(tzQuery.day('date_col')).toBe(`EXTRACT(DAY FROM ${tz('date_col')})::int`);
    });

    it('datetimeFormat formats timezone-normalized timestamp', () => {
      expect(tzQuery.datetimeFormat('date_col', `'%Y'`)).toBe(`TO_CHAR(${tz('date_col')}, '%Y')`);
    });

    it('isAfter compares timezone-normalized expressions', () => {
      expect(tzQuery.isAfter('date_a', 'date_b')).toBe(`${tz('date_a')} > ${tz('date_b')}`);
    });

    it('isBefore compares timezone-normalized expressions', () => {
      expect(tzQuery.isBefore('date_a', 'date_b')).toBe(`${tz('date_a')} < ${tz('date_b')}`);
    });

    it('isSame normalizes unit comparisons after timezone conversion', () => {
      expect(tzQuery.isSame('date_a', 'date_b', `'hour'`)).toBe(
        `DATE_TRUNC('hour', ${tz('date_a')}) = DATE_TRUNC('hour', ${tz('date_b')})`
      );
    });

    it('hour extracts hour after timezone normalization', () => {
      expect(tzQuery.hour('date_col')).toBe(`EXTRACT(HOUR FROM ${tz('date_col')})::int`);
    });

    it('minute extracts minute after timezone normalization', () => {
      expect(tzQuery.minute('date_col')).toBe(`EXTRACT(MINUTE FROM ${tz('date_col')})::int`);
    });

    it('second extracts second after timezone normalization', () => {
      expect(tzQuery.second('date_col')).toBe(`EXTRACT(SECOND FROM ${tz('date_col')})::int`);
    });

    it('month extracts month after timezone normalization', () => {
      expect(tzQuery.month('date_col')).toBe(`EXTRACT(MONTH FROM ${tz('date_col')})::int`);
    });

    it('year extracts year after timezone normalization', () => {
      expect(tzQuery.year('date_col')).toBe(`EXTRACT(YEAR FROM ${tz('date_col')})::int`);
    });

    it('weekNum extracts week number after timezone normalization', () => {
      expect(tzQuery.weekNum('date_col')).toBe(`EXTRACT(WEEK FROM ${tz('date_col')})::int`);
    });

    it('weekday extracts day of week after timezone normalization', () => {
      expect(tzQuery.weekday('date_col')).toBe(`EXTRACT(DOW FROM ${tz('date_col')})::int`);
    });

    it('toNow computes epoch difference using timezone context', () => {
      expect(tzQuery.toNow('date_col')).toBe(
        `EXTRACT(EPOCH FROM (${tz('date_col')} - (NOW() AT TIME ZONE '${timeZone}')))`
      );
    });

    it('datetimeDiff subtracts the second argument from the first after timezone normalization', () => {
      expect(tzQuery.datetimeDiff('first_col', 'second_col', `'day'`)).toBe(
        `(EXTRACT(EPOCH FROM (${tz('first_col')} - ${tz('second_col')}))) / 86400`
      );
    });

    it('fromNow uses timezone-aware current timestamp', () => {
      expect(tzQuery.fromNow('date_col')).toBe(
        `EXTRACT(EPOCH FROM ((NOW() AT TIME ZONE '${timeZone}') - ${tz('date_col')}))`
      );
    });

    it('escapes single quotes in timezone identifiers', () => {
      const customTzQuery = new SelectQueryPostgres();
      customTzQuery.setContext(createTimezoneContext("America/St_John's"));

      expect(customTzQuery.datestr('date_col')).toBe(
        `(${tzWrap('date_col', "America/St_John's")})::date::text`
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
    expect(sql).toBe(`${localWrap('date_col')} + (${scaled}) * INTERVAL '1 ${unit}'`);
  });

  const localDiffBase = `(EXTRACT(EPOCH FROM (${localWrap('date_start')} - ${localWrap('date_end')})))`;
  const datetimeDiffCases: Array<{ literal: string; expected: string }> = [
    { literal: 'millisecond', expected: `${localDiffBase} * 1000` },
    { literal: 'milliseconds', expected: `${localDiffBase} * 1000` },
    { literal: 'ms', expected: `${localDiffBase} * 1000` },
    { literal: 'second', expected: `${localDiffBase}` },
    { literal: 'seconds', expected: `${localDiffBase}` },
    { literal: 'sec', expected: `${localDiffBase}` },
    { literal: 'secs', expected: `${localDiffBase}` },
    { literal: 'minute', expected: `${localDiffBase} / 60` },
    { literal: 'minutes', expected: `${localDiffBase} / 60` },
    { literal: 'min', expected: `${localDiffBase} / 60` },
    { literal: 'mins', expected: `${localDiffBase} / 60` },
    { literal: 'hour', expected: `${localDiffBase} / 3600` },
    { literal: 'hours', expected: `${localDiffBase} / 3600` },
    { literal: 'hr', expected: `${localDiffBase} / 3600` },
    { literal: 'hrs', expected: `${localDiffBase} / 3600` },
    { literal: 'week', expected: `${localDiffBase} / (86400 * 7)` },
    { literal: 'weeks', expected: `${localDiffBase} / (86400 * 7)` },
    { literal: 'day', expected: `${localDiffBase} / 86400` },
    { literal: 'days', expected: `${localDiffBase} / 86400` },
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
      `DATE_TRUNC('${expectedUnit}', ${localWrap('date_a')}) = DATE_TRUNC('${expectedUnit}', ${localWrap('date_b')})`
    );
  });

  describe('numeric aggregate rewrites', () => {
    it('sum rewrites multiple params to addition with numeric coercion', () => {
      const sql = query.sum(['column_a', 'column_b', '10']);
      expect(sql).toBe(
        "(COALESCE(NULLIF(REGEXP_REPLACE(((column_a)::text), '[^0-9.+-]', '', 'g'), '')::double precision, 0) + COALESCE(NULLIF(REGEXP_REPLACE(((column_b)::text), '[^0-9.+-]', '', 'g'), '')::double precision, 0) + COALESCE((10)::double precision, 0))"
      );
    });

    it('average divides the rewritten sum by parameter count', () => {
      const sql = query.average(['column_a', '10']);
      expect(sql).toBe(
        "((COALESCE(NULLIF(REGEXP_REPLACE(((column_a)::text), '[^0-9.+-]', '', 'g'), '')::double precision, 0) + COALESCE((10)::double precision, 0))) / 2"
      );
    });
  });
});

describe('Select formula boolean normalization', () => {
  const knexClient = knex({ client: 'pg' });
  const provider = new PostgresProvider(knexClient);

  const booleanFieldVo: IFieldVo = {
    id: 'fldBoolean001',
    name: 'Boolean Flag',
    type: FieldType.Checkbox,
    options: {},
    dbFieldName: 'bool_col',
    dbFieldType: DbFieldType.Boolean,
    cellValueType: CellValueType.Boolean,
    isLookup: false,
    isComputed: false,
    isMultipleCellValue: false,
  };

  const textFieldVo: IFieldVo = {
    id: 'fldText001',
    name: 'Text Field',
    type: FieldType.SingleLineText,
    options: {},
    dbFieldName: 'text_col',
    dbFieldType: DbFieldType.Text,
    cellValueType: CellValueType.String,
    isLookup: false,
    isComputed: false,
    isMultipleCellValue: false,
  };

  const booleanField = createFieldInstanceByVo(booleanFieldVo);
  const textField = createFieldInstanceByVo(textFieldVo);

  const table = new TableDomain({
    id: 'tblBoolean',
    name: 'Boolean Table',
    dbTableName: 'boolean_table',
    lastModifiedTime: '1970-01-01T00:00:00.000Z',
    fields: [booleanField, textField],
  });

  const buildContext = (): ISelectFormulaConversionContext => ({
    table,
    tableAlias: 'main',
    selectionMap: new Map<string, IFieldSelectName>([
      [booleanField.id, '"main"."bool_col"'],
      [textField.id, '"main"."text_col"'],
    ]),
    timeZone: 'UTC',
    preferRawFieldReferences: true,
  });

  it('casts boolean field references before PostgreSQL COALESCE', () => {
    const sql = provider.convertFormulaToSelectQuery('AND({fldBoolean001})', buildContext());

    expect(sql).toContain('(("main"."bool_col"))::boolean');
    expect(sql).toContain('COALESCE');
  });

  it('does not cast non-boolean field references', () => {
    const sql = provider.convertFormulaToSelectQuery('AND({fldText001})', buildContext());

    expect(sql).not.toContain('::boolean');
  });
});

describe('Select formula arithmetic coercion', () => {
  const knexClient = knex({ client: 'pg' });
  const provider = new PostgresProvider(knexClient);

  const leftFieldVo: IFieldVo = {
    id: 'fldLeftText001',
    name: 'Left Text',
    type: FieldType.SingleLineText,
    options: {},
    dbFieldName: 'left_text_col',
    dbFieldType: DbFieldType.Text,
    cellValueType: CellValueType.String,
    isLookup: false,
    isComputed: false,
    isMultipleCellValue: false,
  };

  const rightFieldVo: IFieldVo = {
    id: 'fldRightText001',
    name: 'Right Text',
    type: FieldType.SingleLineText,
    options: {},
    dbFieldName: 'right_text_col',
    dbFieldType: DbFieldType.Text,
    cellValueType: CellValueType.String,
    isLookup: false,
    isComputed: false,
    isMultipleCellValue: false,
  };

  const leftField = createFieldInstanceByVo(leftFieldVo);
  const rightField = createFieldInstanceByVo(rightFieldVo);

  const table = new TableDomain({
    id: 'tblArithmeticText',
    name: 'Arithmetic Text Table',
    dbTableName: 'arithmetic_text_table',
    lastModifiedTime: '1970-01-01T00:00:00.000Z',
    fields: [leftField, rightField],
  });

  const buildContext = (): ISelectFormulaConversionContext => ({
    table,
    tableAlias: 'main',
    selectionMap: new Map<string, IFieldSelectName>([
      [leftField.id, '"main"."left_text_col"'],
      [rightField.id, '"main"."right_text_col"'],
    ]),
    timeZone: 'UTC',
    preferRawFieldReferences: true,
  });

  it('coerces text operands when subtracting in select SQL', () => {
    const sql = provider.convertFormulaToSelectQuery(
      `{${leftField.id}} - {${rightField.id}}`,
      buildContext()
    );

    expect(sql).toContain(
      "REGEXP_REPLACE(((\"main\".\"left_text_col\")::text), '[^0-9.+-]', '', 'g')"
    );
    expect(sql).toContain(
      "REGEXP_REPLACE(((\"main\".\"right_text_col\")::text), '[^0-9.+-]', '', 'g')"
    );
    expect(sql).toContain('::double precision');
    expect(sql).not.toContain('"main"."left_text_col" - "main"."right_text_col"');
  });

  it('coerces unary minus of text operands', () => {
    const sql = provider.convertFormulaToSelectQuery(`-{${rightField.id}}`, buildContext());

    expect((sql as string).trim().startsWith('(-')).toBe(true);
    expect(sql).toContain(
      "REGEXP_REPLACE(((\"main\".\"right_text_col\")::text), '[^0-9.+-]', '', 'g')"
    );
    expect(sql).toContain('::double precision');
  });
});

describe('Select formula string comparisons', () => {
  const query = new SelectQueryPostgres();
  const tableStub = {
    fieldList: [
      { dbFieldName: 'text_col', dbFieldType: DbFieldType.Text },
      { dbFieldName: 'json_col', dbFieldType: DbFieldType.Json },
    ],
  } as unknown as TableDomain;

  const buildContext = (): ISelectFormulaConversionContext => ({
    table: tableStub,
    selectionMap: new Map<string, IFieldSelectName>(),
  });

  it('coerces JSON operands to text when compared with text columns', () => {
    query.setContext(buildContext());
    const sql = query.equal('"main"."text_col"', '"main"."json_col"');

    expect(sql).toContain('jsonb_typeof(to_jsonb("main"."json_col"))');
    expect(sql).toContain('CASE jsonb_typeof(to_jsonb("main"."json_col"))');
    expect(sql).toContain('WHEN \'string\' THEN to_jsonb("main"."json_col") #>> \'{}\'');
    expect(sql).toContain('ELSE to_jsonb("main"."json_col")::text');
    expect(sql).toContain('("main"."text_col")::text');
    expect(sql).not.toContain('= "main"."json_col"');
  });
});

describe('Select formula string branch normalization', () => {
  const knexClient = knex({ client: 'pg' });
  const provider = new PostgresProvider(knexClient);

  const jsonFieldVo: IFieldVo = {
    id: 'fldJson001',
    name: 'Json Field',
    type: FieldType.MultipleSelect,
    options: {},
    dbFieldName: 'json_col',
    dbFieldType: DbFieldType.Json,
    cellValueType: CellValueType.String,
    isLookup: false,
    isComputed: false,
    isMultipleCellValue: true,
  };

  const jsonField = createFieldInstanceByVo(jsonFieldVo);

  const table = new TableDomain({
    id: 'tblStringBranches',
    name: 'String Branch Table',
    dbTableName: 'string_branch_table',
    lastModifiedTime: '1970-01-01T00:00:00.000Z',
    fields: [jsonField],
  });

  const buildContext = (): ISelectFormulaConversionContext => ({
    table,
    tableAlias: 'main',
    selectionMap: new Map<string, IFieldSelectName>([[jsonField.id, '"main"."json_col"']]),
    timeZone: 'UTC',
    preferRawFieldReferences: true,
  });

  it('casts JSON-backed false branches to text inside IF expressions', () => {
    const formula = `IF(
      FIND(",", {${jsonField.id}} & "") > 0,
      LEFT({${jsonField.id}} & "", FIND(",", {${jsonField.id}} & "") - 1),
      {${jsonField.id}}
    )`;

    const sql = provider.convertFormulaToSelectQuery(formula, buildContext());

    expect(sql).toContain('ELSE ("main"."json_col")::text');
  });
});
