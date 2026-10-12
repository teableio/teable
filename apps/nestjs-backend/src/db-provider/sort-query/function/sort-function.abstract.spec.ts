import type { FieldCore } from '@teable/core';
import knex from 'knex';
import { describe, expect, it } from 'vitest';
import { AbstractSortFunction } from './sort-function.abstract';

class TestSortFunction extends AbstractSortFunction {
  get column() {
    return this.columnName;
  }
}

const columnFor = (dbFieldName: string) =>
  new TestSortFunction(knex({ client: 'pg' }), { id: 'fld1', dbFieldName } as FieldCore).column;

describe('AbstractSortFunction column quoting', () => {
  it('quotes a bare column name', () => {
    expect(columnFor('age')).toBe('"age"');
  });

  it('keeps an already-quoted, schema-qualified column as it is', () => {
    expect(columnFor('"bse1"."tbl1"."age"')).toBe('"bse1"."tbl1"."age"');
    expect(columnFor('"we""ird"')).toBe('"we""ird"');
  });

  it('escapes anything that only looks quoted', () => {
    expect(columnFor('"a"; drop table t; --"')).toBe('"""a""; drop table t; --"""');
    expect(columnFor('"a" desc, (select 1)--"')).toBe('"""a"" desc, (select 1)--"""');
    expect(columnFor('x"y')).toBe('"x""y"');
  });
});
