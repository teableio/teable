import type { FieldCore } from '@teable-group/core';
import { CellValueType, DbFieldType, FieldType, filter, NumberFieldCore } from '@teable-group/core';
import { plainToInstance } from 'class-transformer';
import knex from 'knex';
import { FilterQueryTranslator } from './filter-query-translator';

describe('FilterQueryTranslator', () => {
  const queryBuilder = knex({ client: 'sqlite3' })('table_name');
  let fieldContext: { [fieldId: string]: FieldCore } = {};

  beforeAll(() => {
    const fieldJson = {
      id: 'fldXPZs9lFMvAIo2E',
      name: 'f1',
      description: 'A test number field',
      notNull: true,
      unique: true,
      isPrimary: true,
      columnMeta: {
        index: 0,
        columnIndex: 0,
      },
      type: FieldType.Number,
      dbFieldName: 'f1_fldXPZs9lFMvAIo2E',
      dbFieldType: DbFieldType.Real,
      options: {
        precision: 2,
      },
      defaultValue: 0,
      cellValueType: CellValueType.Number,
      isComputed: false,
    };

    const field = plainToInstance(NumberFieldCore, fieldJson);
    fieldContext = {
      [field.id]: field,
    };
  });

  it('should to parse correctly SQL Where', async () => {
    const jsonFilter = filter.parse({
      filterSet: [
        {
          fieldId: 'fldXPZs9lFMvAIo2E',
          operator: 'isNot',
          value: null,
        },
        {
          filterSet: [
            {
              fieldId: 'fldXPZs9lFMvAIo2E',
              operator: 'is',
              value: 1,
            },
            {
              fieldId: 'fldXPZs9lFMvAIo2E',
              operator: 'isNot',
              value: 2,
            },
          ],
          conjunction: 'and',
        },
        {
          filterSet: [
            {
              fieldId: 'fldXPZs9lFMvAIo2E',
              operator: 'is',
              value: 3,
            },
            {
              fieldId: 'fldXPZs9lFMvAIo2E',
              operator: 'isEmpty',
              value: null,
            },
          ],
          conjunction: 'and',
        },
      ],
      conjunction: 'or',
    });

    new FilterQueryTranslator(queryBuilder, fieldContext, jsonFilter).translateToSql();

    expect(queryBuilder.toQuery()).toMatch(
      '(`f1_fldXPZs9lFMvAIo2E` = 1 and not `f1_fldXPZs9lFMvAIo2E` = 2) or (`f1_fldXPZs9lFMvAIo2E` = 3 and `f1_fldXPZs9lFMvAIo2E` is null)'
    );
  });
});
