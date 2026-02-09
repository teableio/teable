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
