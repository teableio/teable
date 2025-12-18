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
