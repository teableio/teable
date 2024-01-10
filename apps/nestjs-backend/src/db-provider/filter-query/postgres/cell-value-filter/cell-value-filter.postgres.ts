import type { IFilterOperator, IFilterValue } from '@teable-group/core';
import { CellValueType, literalValueListSchema } from '@teable-group/core';
import type { Knex } from 'knex';
import { AbstractCellValueFilter } from '../../cell-value-filter.abstract';

export class CellValueFilterPostgres extends AbstractCellValueFilter {
  isNotOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IFilterValue
  ): Knex.QueryBuilder {
    const { cellValueType } = this.field;
    const parseValue = cellValueType === CellValueType.Number ? Number(value) : value;

    builderClient.whereRaw(`?? IS DISTINCT FROM ?`, [this.columnName, parseValue]);
    return builderClient;
  }

  doesNotContainOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IFilterValue
  ): Knex.QueryBuilder {
    builderClient.whereRaw(`COALESCE(??, '') NOT LIKE ?`, [this.columnName, `%${value}%`]);
    return builderClient;
  }

  isNoneOfOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IFilterValue
  ): Knex.QueryBuilder {
    const valueList = literalValueListSchema.parse(value);

    const sql = `COALESCE(??, '') NOT IN (${this.createSqlPlaceholders(valueList)})`;
    builderClient.whereRaw(sql, [this.columnName, ...valueList]);
    return builderClient;
  }
}
