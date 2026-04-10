import { TableDomain } from '@teable/core';
import knex from 'knex';
import { describe, expect, it } from 'vitest';
import type { IFieldSelectName } from '../features/record/query-builder/field-select.type';
import type { ISelectFormulaConversionContext } from '../features/record/query-builder/sql-conversion.visitor';
import { PostgresProvider } from './postgres.provider';
import { SqliteProvider } from './sqlite.provider';

const emptyTable = new TableDomain({
  id: 'tblFormulaUnit',
  name: 'Formula Unit',
  dbTableName: 'public.tbl_formula_unit',
  lastModifiedTime: '2026-04-08T00:00:00.000Z',
  fields: [],
});

const toSql = (result: IFieldSelectName) => {
  return typeof result === 'string' ? result : result.toQuery();
};

const context: ISelectFormulaConversionContext = {
  table: emptyTable,
  selectionMap: new Map(),
  tableAlias: 'main',
  timeZone: 'UTC',
};

describe('convertFormulaToSelectQuery DATETIME_DIFF defaults', () => {
  it('defaults DATETIME_DIFF to seconds for postgres select queries', () => {
    const provider = new PostgresProvider(knex({ client: 'pg' }));
    const sql = toSql(
      provider.convertFormulaToSelectQuery(
        `DATETIME_DIFF(DATETIME_PARSE("2024-01-03T00:00:00.000Z"), DATETIME_PARSE("2024-01-01T00:00:00.000Z"))`,
        context
      )
    );

    expect(sql).toContain('EXTRACT(EPOCH');
    expect(sql).not.toContain('/ 86400');
  });

  it('defaults DATETIME_DIFF to seconds for sqlite select queries', () => {
    const provider = new SqliteProvider(knex({ client: 'sqlite3' }));
    const sql = toSql(
      provider.convertFormulaToSelectQuery(
        `DATETIME_DIFF(DATETIME_PARSE("2024-01-03T00:00:00.000Z"), DATETIME_PARSE("2024-01-01T00:00:00.000Z"))`,
        context
      )
    );

    expect(sql).toContain('* 24.0 * 60 * 60');
    expect(sql).not.toContain('/ 86400');
  });
});
