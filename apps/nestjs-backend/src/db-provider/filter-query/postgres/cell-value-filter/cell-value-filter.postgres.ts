import type { IFilterOperator, IFilterValue } from '@teable-group/core';
import { CellValueType, literalValueListSchema } from '@teable-group/core';
import type { Knex } from 'knex';
import type { IFieldInstance } from '../../../../features/field/model/factory';
import { AbstractCellValueFilter } from '../../cell-value-filter.abstract';

export class CellValueFilterPostgres extends AbstractCellValueFilter {
  isNotOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: IFilterValue }
  ): Knex.QueryBuilder {
    const { field, value } = params;
    const parseValue = field.cellValueType === CellValueType.Number ? Number(value) : value;

    queryBuilder.whereRaw(`?? IS DISTINCT FROM ?`, [field.dbFieldName, parseValue]);
    return queryBuilder;
  }

  doesNotContainOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: IFilterValue }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    queryBuilder.whereRaw(`COALESCE(??, '') NOT LIKE ?`, [field.dbFieldName, `%${value}%`]);
    return queryBuilder;
  }

  isNoneOfOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: {
      field: IFieldInstance;
      operator: IFilterOperator;
      value: IFilterValue;
    }
  ): Knex.QueryBuilder {
    const { field, value } = params;
    const valueList = literalValueListSchema.parse(value);

    const sql = `COALESCE(??, '') NOT IN (${super.createSqlPlaceholders(valueList)})`;
    queryBuilder.whereRaw(sql, [field.dbFieldName, ...valueList]);
    return queryBuilder;
  }
}
