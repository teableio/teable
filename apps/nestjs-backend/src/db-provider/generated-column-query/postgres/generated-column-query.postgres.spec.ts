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
});
