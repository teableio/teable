import {
  CellValueType,
  DbFieldType,
  FieldType,
  SortFunc,
  type FieldCore,
  type ISortItem,
} from '@teable/core';
import knex from 'knex';
import { describe, expect, it } from 'vitest';
import { SortQueryPostgres } from './postgres/sort-query.postgres';

const createField = (overrides: Partial<FieldCore> = {}): FieldCore =>
  ({
    id: 'fld1',
    dbFieldName: 'name',
    type: FieldType.SingleLineText,
    cellValueType: CellValueType.String,
    dbFieldType: DbFieldType.Text,
    isComputed: false,
    isMultipleCellValue: false,
    ...overrides,
  }) as FieldCore;

const createSortQuery = (
  field: FieldCore,
  order: SortFunc = SortFunc.Asc,
  collation: ISortItem['collation'] = 'zh-pinyin'
) => {
  const client = knex({ client: 'pg' });
  return new SortQueryPostgres(client, client('records'), { [field.id]: field }, [
    { fieldId: field.id, order, ...(collation ? { collation } : {}) },
  ]);
};

describe('legacy sort collation', () => {
  it('applies ICU pinyin collation to native text in builders and raw SQL', () => {
    const field = createField({ dbFieldName: 'title' });
    const builderSql = createSortQuery(field).appendSortBuilder().toQuery();
    const rawSql = createSortQuery(field).getRawSortSQLText();

    expect(builderSql).toContain(
      `order by ("title") COLLATE "zh-x-icu" ASC NULLS FIRST`
    );
    expect(rawSql).toContain(`("title") COLLATE "zh-x-icu" ASC NULLS FIRST`);
  });

  it('applies ICU pinyin collation to a single-value link title', () => {
    const field = createField({
      dbFieldName: 'link',
      type: FieldType.Link,
      dbFieldType: DbFieldType.Json,
    });

    expect(createSortQuery(field, SortFunc.Desc).getRawSortSQLText()).toContain(
      `("link"::jsonb ->> 'title') COLLATE "zh-x-icu" DESC NULLS LAST`
    );
  });

  it.each([
    ['computed text', createField({ isComputed: true })],
    [
      'multiple-value link',
      createField({
        type: FieldType.Link,
        dbFieldType: DbFieldType.Json,
        isMultipleCellValue: true,
      }),
    ],
    [
      'number',
      createField({
        type: FieldType.Number,
        cellValueType: CellValueType.Number,
        dbFieldType: DbFieldType.Real,
      }),
    ],
  ])('rejects zh-pinyin for unsupported %s fields', (_name, field) => {
    expect(() => createSortQuery(field).getRawSortSQLText()).toThrow(
      `Collation zh-pinyin is not supported for field ${field.id} (${field.type})`
    );
  });
});
