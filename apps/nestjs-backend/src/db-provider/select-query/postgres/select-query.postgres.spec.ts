/* eslint-disable sonarjs/no-duplicate-string */
import { DbFieldType } from '@teable/core';
import { describe, expect, it } from 'vitest';

import { getDefaultDatetimeParsePattern } from '../../utils/default-datetime-parse-pattern';
import { SelectQueryPostgres } from './select-query.postgres';

describe('SelectQueryPostgres tzWrap', () => {
  it('sanitizes text-like datetime inputs even when SQL contains timestamp tokens', () => {
    const query = new SelectQueryPostgres();
    query.setContext({ timeZone: 'Asia/Shanghai' } as unknown as never);
    query.setCallMetadata([{ type: 'string', isFieldReference: false }] as unknown as never);

    const expr =
      "CONCAT(TO_CHAR(TIMEZONE('Etc/GMT-8', (col)::timestamptz), 'YYYY-MM-DD'), ' ', col2)";
    const sql = query.datetimeFormat(expr, "'HH:mm:ss'");

    expect(sql).toContain('BTRIM');
    expect(sql).toContain('CASE WHEN');
    expect(sql).toContain(getDefaultDatetimeParsePattern());
  });

  it('does not sanitize trusted datetime inputs', () => {
    const query = new SelectQueryPostgres();
    query.setContext({ timeZone: 'Asia/Shanghai' } as unknown as never);
    query.setCallMetadata([{ type: 'datetime', isFieldReference: false }] as unknown as never);

    const sql = query.datetimeFormat('col', "'HH:mm:ss'");
    expect(sql).not.toContain('BTRIM');
  });
});

describe('SelectQueryPostgres truthinessScore', () => {
  it('casts boolean-like expressions before COALESCE to avoid text/boolean type errors', () => {
    const query = new SelectQueryPostgres();
    query.setContext({ timeZone: 'Asia/Shanghai' } as unknown as never);
    query.setCallMetadata([{ type: 'boolean', isFieldReference: false }] as unknown as never);

    const sql = query.if("('true')::text", "'yes'", "'no'");
    expect(sql).toContain("COALESCE((('true')::text)::boolean, FALSE)");
  });

  it('coerces json-like numeric branches in IF to avoid CASE jsonb/integer mismatches', () => {
    const query = new SelectQueryPostgres();
    query.setContext({
      timeZone: 'Asia/Shanghai',
      targetDbFieldType: DbFieldType.Real,
    } as unknown as never);
    query.setCallMetadata([
      { type: 'string', isFieldReference: false },
      {
        type: 'string',
        isFieldReference: true,
        field: {
          id: 'fldJsonNumeric',
          isMultiple: true,
          isLookup: true,
          dbFieldName: '__json_numeric',
          dbFieldType: DbFieldType.Json,
          cellValueType: 'number',
        },
      },
      { type: 'number', isFieldReference: false },
    ] as unknown as never);

    const sql = query.if('__cond', '"__json_numeric"', '0');
    expect(sql).toContain('to_jsonb("__json_numeric")');
    expect(sql).toContain('jsonb_array_elements_text');
    expect(sql).toContain('double precision');
  });
});

describe('SelectQueryPostgres countAll', () => {
  it('counts JSON array length for multi-value field references', () => {
    const query = new SelectQueryPostgres();
    query.setContext({ tableAlias: 't' } as unknown as never);
    query.setCallMetadata([
      {
        type: 'string',
        isFieldReference: true,
        field: {
          id: 'fldUsers',
          isMultiple: true,
          isLookup: false,
          dbFieldName: '__users',
          dbFieldType: DbFieldType.Json,
          cellValueType: 'string',
        },
      },
    ] as unknown as never);

    const sql = query.countAll('(SELECT json_agg(x) FROM x)');
    expect(sql).toContain('jsonb_array_length');
    expect(sql).toContain(`"t"."__users"`);
  });

  it('uses scalar null-check semantics for non-json fields', () => {
    const query = new SelectQueryPostgres();
    query.setContext({ tableAlias: 't' } as unknown as never);
    query.setCallMetadata([
      {
        type: 'number',
        isFieldReference: true,
        field: {
          id: 'fldNum',
          isMultiple: false,
          isLookup: false,
          dbFieldName: '__num',
          dbFieldType: DbFieldType.Real,
          cellValueType: 'number',
        },
      },
    ] as unknown as never);

    expect(query.countAll('"t"."__num"')).toBe('CASE WHEN "t"."__num" IS NULL THEN 0 ELSE 1 END');
  });
});

describe('SelectQueryPostgres FROMNOW/TONOW', () => {
  it('applies unit conversion for FROMNOW', () => {
    const query = new SelectQueryPostgres();

    const daySql = query.fromNow('NOW()', "'day'");
    const hourSql = query.fromNow('NOW()', "'hour'");
    const secondSql = query.fromNow('NOW()', "'second'");

    expect(daySql).toContain('/ 86400');
    expect(hourSql).toContain('/ 3600');
    expect(secondSql).not.toContain('/ 86400');
    expect(secondSql).not.toContain('/ 3600');
  });

  it('keeps TONOW direction as now minus date for past-positive semantics', () => {
    const query = new SelectQueryPostgres();

    const sql = query.toNow('date_col', "'day'");
    expect(sql).toContain('NOW() -');
    expect(sql).not.toContain('date_col::timestamp - NOW()');
  });
});

describe('SelectQueryPostgres workday', () => {
  it('uses interval multiplication for dynamic day-count expressions', () => {
    const query = new SelectQueryPostgres();
    query.setContext({ timeZone: 'Asia/Shanghai' } as unknown as never);
    query.setCallMetadata([
      { type: 'datetime', isFieldReference: true },
      { type: 'number', isFieldReference: true },
    ] as unknown as never);

    const sql = query.workday('"t"."Date"', '"t"."Number"');
    expect(sql).toContain(`INTERVAL '1 day' * ("t"."Number")::double precision`);
    expect(sql).not.toContain(" days'");
  });
});
