import { DbFieldType } from '@teable/core';
import { describe, expect, it } from 'vitest';
import { GeneratedColumnQuerySqlite } from './generated-column-query.sqlite';

describe('GeneratedColumnQuerySqlite countAll', () => {
  it('counts multi-value json field elements in COUNTALL', () => {
    const query = new GeneratedColumnQuerySqlite();
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

    const sql = query.countAll('`__owners`');
    expect(sql).toContain('json_array_length');
    expect(sql).toContain("json_type(`__owners`) = 'array'");
  });

  it('keeps scalar COUNTALL behavior for non-json field', () => {
    const query = new GeneratedColumnQuerySqlite();
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

    expect(query.countAll('`__number`')).toBe('CASE WHEN `__number` IS NULL THEN 0 ELSE 1 END');
  });
});

describe('GeneratedColumnQuerySqlite FROMNOW/TONOW', () => {
  it('applies unit conversion for FROMNOW', () => {
    const query = new GeneratedColumnQuerySqlite();
    query.setContext({} as unknown as never);

    const daySql = query.fromNow('date_col', "'day'");
    const hourSql = query.fromNow('date_col', "'hour'");
    const secondSql = query.fromNow('date_col', "'second'");

    expect(daySql).toBe("(JULIANDAY('now') - JULIANDAY(DATETIME(date_col)))");
    expect(hourSql).toBe("((JULIANDAY('now') - JULIANDAY(DATETIME(date_col)))) * 24.0");
    expect(secondSql).toBe("((JULIANDAY('now') - JULIANDAY(DATETIME(date_col)))) * 24.0 * 60 * 60");
  });

  it('keeps TONOW aligned with FROMNOW direction', () => {
    const query = new GeneratedColumnQuerySqlite();
    query.setContext({} as unknown as never);

    const fromNowSql = query.fromNow('date_col', "'day'");
    const toNowSql = query.toNow('date_col', "'day'");
    expect(toNowSql).toBe(fromNowSql);
  });
});
