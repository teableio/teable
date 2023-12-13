/* eslint-disable @typescript-eslint/no-explicit-any */
import type { IFieldVo, ISortItem } from '@teable-group/core';
import { CellValueType, DbFieldType, FieldType } from '@teable-group/core';
import knex from 'knex';
import { keyBy } from 'lodash';
import type { IFieldInstance } from '../../field/model/factory';
import { createFieldInstanceByVo } from '../../field/model/factory';
import { SortQueryTranslator } from './sort-query-translator';

describe('SortQueryTranslator', () => {
  let _knex: any;
  let queryBuilder: any;
  let fieldContext: { [fieldId: string]: IFieldInstance } = {};

  beforeEach(() => {
    _knex = knex({ client: 'sqlite3' });
    queryBuilder = _knex('table_name');
  });

  beforeAll(() => {
    const fieldsJson: IFieldVo[] = [
      {
        id: 'fld1',
        name: 'name',
        type: FieldType.SingleLineText,
        dbFieldName: 'name_fld1',
        dbFieldType: DbFieldType.Text,
        cellValueType: CellValueType.String,
        isMultipleCellValue: false,
        options: {},
      },
      {
        id: 'fld2',
        name: 'number',
        type: FieldType.Number,
        dbFieldName: 'number_fld2',
        dbFieldType: DbFieldType.Real,
        cellValueType: CellValueType.Number,
        isMultipleCellValue: false,
        options: {},
      },
      {
        id: 'fld3',
        name: 'tags',
        type: FieldType.MultipleSelect,
        dbFieldName: 'tags_fld3',
        dbFieldType: DbFieldType.Json,
        cellValueType: CellValueType.String,
        isMultipleCellValue: true,
        options: {},
      },
    ];

    const fields = fieldsJson.map((field) => createFieldInstanceByVo(field));
    fieldContext = keyBy(fields, 'id');
  });

  it('should return empty array, if the fields is undefined for (translateToOrderQuery)', () => {
    const translatedOrderBy = new SortQueryTranslator(_knex, queryBuilder).appendQueryBuilder();

    expect(translatedOrderBy).toBeDefined();
    expect(translatedOrderBy.toQuery()).toStrictEqual(queryBuilder.toQuery());
  });

  it('should return correct orderBy for (translateToOrderQuery)', () => {
    const orderBy: ISortItem[] = [
      {
        fieldId: 'fld1',
        order: 'asc',
      },
      {
        fieldId: 'fld2',
        order: 'desc',
      },
      {
        fieldId: 'fld3',
        order: 'desc',
      },
    ];

    const rawSql = new SortQueryTranslator(
      _knex,
      queryBuilder,
      fieldContext,
      orderBy
    ).appendQueryBuilder();

    expect(rawSql.toQuery()).toMatch(`\`name_fld1\` asc NULLS FIRST`);
    expect(rawSql.toQuery()).toMatch(`\`number_fld2\` desc NULLS LAST`);
    expect(rawSql.toQuery()).toMatch(`CAST(\`tags_fld3\` as text) desc NULLS LAST`);
  });
});
