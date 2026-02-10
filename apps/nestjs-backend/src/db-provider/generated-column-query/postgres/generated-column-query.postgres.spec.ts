import { DbFieldType } from '@teable/core';
import { describe, expect, it } from 'vitest';

import { GeneratedColumnQueryPostgres } from './generated-column-query.postgres';

describe('GeneratedColumnQueryPostgres if', () => {
  it('coerces json-like numeric branches in IF to avoid CASE jsonb/integer mismatches', () => {
    const query = new GeneratedColumnQueryPostgres();
    query.setContext({} as unknown as never);
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

  it('counts multi-value json field elements in COUNTALL', () => {
    const query = new GeneratedColumnQueryPostgres();
    query.setContext({} as unknown as never);
    query.setCallMetadata([
      {
        type: 'string',
        isFieldReference: true,
        field: {
          id: 'fldMulti',
          isMultiple: true,
          isLookup: false,
          dbFieldName: '__owners',
          dbFieldType: DbFieldType.Json,
          cellValueType: 'string',
        },
      },
    ] as unknown as never);

    const sql = query.countAll('"__owners"');
    expect(sql).toContain('jsonb_array_length');
    expect(sql).toContain(`NULLIF(("__owners")::jsonb, 'null'::jsonb)`);
  });

  it('keeps scalar COUNTALL behavior for non-json field', () => {
    const query = new GeneratedColumnQueryPostgres();
    query.setContext({} as unknown as never);
    query.setCallMetadata([
      {
        type: 'number',
        isFieldReference: true,
        field: {
          id: 'fldNumber',
          isMultiple: false,
          isLookup: false,
          dbFieldName: '__number',
          dbFieldType: DbFieldType.Real,
          cellValueType: 'number',
        },
      },
    ] as unknown as never);

    expect(query.countAll('"__number"')).toBe('CASE WHEN "__number" IS NULL THEN 0 ELSE 1 END');
  });
});

describe('GeneratedColumnQueryPostgres FROMNOW/TONOW', () => {
  it('applies unit conversion for FROMNOW', () => {
    const query = new GeneratedColumnQueryPostgres();
    query.setContext({} as unknown as never);

    const daySql = query.fromNow('NOW()', "'day'");
    const hourSql = query.fromNow('NOW()', "'hour'");
    const secondSql = query.fromNow('NOW()', "'second'");

    expect(daySql).toContain('/ 86400');
    expect(hourSql).toContain('/ 3600');
    expect(secondSql).not.toContain('/ 86400');
    expect(secondSql).not.toContain('/ 3600');
  });

  it('keeps TONOW direction as now minus date for past-positive semantics', () => {
    const query = new GeneratedColumnQueryPostgres();
    query.setContext({} as unknown as never);

    const sql = query.toNow('NOW()', "'day'");
    expect(sql).toContain('NOW() -');
    expect(sql).not.toContain(' - NOW()');
  });
});
