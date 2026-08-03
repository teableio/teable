import { CellValueType, DateFormattingPreset, FieldType, TimeFormatting } from '@teable/core';
import { TableIndex } from '@teable/openapi';
import knex from 'knex';
import { describe, expect, it } from 'vitest';
import type { IFieldInstance } from '../../features/field/model/factory';
import { SearchQueryPostgres } from './search-query.postgres';

const buildDateField = (): IFieldInstance =>
  ({
    id: 'fldDateSearch00001',
    dbFieldName: 'Due_Date',
    cellValueType: CellValueType.DateTime,
    isMultipleCellValue: false,
    isStructuredCellValue: false,
    type: FieldType.Date,
    options: {
      formatting: {
        date: DateFormattingPreset.ISO,
        time: TimeFormatting.None,
        timeZone: 'Asia/Shanghai',
      },
    },
  }) as IFieldInstance;

const buildMultipleSelectField = (): IFieldInstance =>
  ({
    id: 'fldMultiSelect0001',
    dbFieldName: 'Tags',
    cellValueType: CellValueType.String,
    isMultipleCellValue: true,
    isStructuredCellValue: false,
    type: FieldType.MultipleSelect,
    options: {},
  }) as IFieldInstance;

describe('SearchQueryPostgres', () => {
  const db = knex({ client: 'pg' });

  it('uses a datetime range for date-like search values when search index is enabled', () => {
    const field = buildDateField();
    const builder = new SearchQueryPostgres(
      db.queryBuilder(),
      field,
      ['2022-03-02', '', true],
      [TableIndex.search]
    );

    const compiled = builder.getQuery()?.toSQL();
    expect(compiled?.sql).toContain('"Due_Date" >= ?::timestamptz AND "Due_Date" < ?::timestamptz');
    expect(compiled?.sql).not.toContain('TO_CHAR');
    expect(compiled?.bindings).toEqual(['2022-03-01T16:00:00.000Z', '2022-03-02T16:00:00.000Z']);
  });

  it('skips date-field scans for non-date-like search values', () => {
    const field = buildDateField();
    const builder = new SearchQueryPostgres(
      db.queryBuilder(),
      field,
      ['not-a-date', '', true],
      [TableIndex.search]
    );

    const compiled = builder.getQuery()?.toSQL();
    expect(compiled?.sql).toBe('FALSE');
  });

  it('matches multipleSelect as a text cast so the gin_trgm index can be used', () => {
    const field = buildMultipleSelectField();
    const builder = new SearchQueryPostgres(
      db.queryBuilder(),
      field,
      ['Beta', 'fldMultiSelect0001'],
      []
    );

    const compiled = builder.getQuery()?.toSQL();
    expect(compiled?.sql).toContain('("Tags")::text ILIKE');
    expect(compiled?.sql).not.toContain('jsonb_array_elements');
    expect(compiled?.bindings).toEqual(['%Beta%']);
  });
});
