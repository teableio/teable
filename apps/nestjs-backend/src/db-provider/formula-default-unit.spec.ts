import { CellValueType, DbFieldType, FieldType, TableDomain } from '@teable/core';
import knex from 'knex';
import { describe, expect, it } from 'vitest';
import { createFieldInstanceByVo } from '../features/field/model/factory';
import type { IFieldSelectName } from '../features/record/query-builder/field-select.type';
import type { ISelectFormulaConversionContext } from '../features/record/query-builder/sql-conversion.visitor';
import { PostgresProvider } from './postgres.provider';

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
});

describe('convertFormulaToGeneratedColumn blank numeric comparisons', () => {
  it('keeps BLANK() as a blank operand when comparing number fields', () => {
    const numberField = createFieldInstanceByVo({
      id: 'fldWeight',
      dbFieldName: 'weight',
      name: 'Weight',
      type: FieldType.Number,
      cellValueType: CellValueType.Number,
      dbFieldType: DbFieldType.Real,
    });
    const table = new TableDomain({
      id: 'tblFormulaUnit',
      name: 'Formula Unit',
      dbTableName: 'public.tbl_formula_unit',
      lastModifiedTime: '2026-04-08T00:00:00.000Z',
      fields: [numberField],
    });
    const provider = new PostgresProvider(knex({ client: 'pg' }));
    const result = provider.convertFormulaToGeneratedColumn('IF({fldWeight}=BLANK(), 1, 2)', {
      table,
      isGeneratedColumn: true,
    });

    expect(result.sql).toContain('CASE WHEN');
    expect(result.sql).toContain('"weight"');
    expect(result.sql).toContain('::text');
    expect(result.sql).toContain("= ''");
  });
});

describe('convertFormulaToSelectQuery blank numeric comparisons', () => {
  it('keeps spaced BLANK() as a blank operand when comparing number fields', () => {
    const numberField = createFieldInstanceByVo({
      id: 'fldWeight',
      dbFieldName: 'weight',
      name: 'Weight',
      type: FieldType.Number,
      cellValueType: CellValueType.Number,
      dbFieldType: DbFieldType.Real,
    });
    const table = new TableDomain({
      id: 'tblFormulaUnit',
      name: 'Formula Unit',
      dbTableName: 'public.tbl_formula_unit',
      lastModifiedTime: '2026-04-08T00:00:00.000Z',
      fields: [numberField],
    });
    const provider = new PostgresProvider(knex({ client: 'pg' }));
    const sql = toSql(
      provider.convertFormulaToSelectQuery('{fldWeight} != BLANK()', {
        ...context,
        table,
      })
    );

    expect(sql).toContain('COALESCE(NULLIF');
    expect(sql).toContain('"weight"');
    expect(sql).not.toContain('::numeric');
    expect(sql).toContain("<> ''");
  });
});
