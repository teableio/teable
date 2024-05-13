import type { IFilterOperator, IFilterValue } from '@teable/core';
import { CellValueType, literalValueListSchema } from '@teable/core';
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
    builderClient.whereRaw(`?? IS DISTINCT FROM ?`, [this.tableColumnRef, parseValue]);
    return builderClient;
  }

  doesNotContainOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IFilterValue
  ): Knex.QueryBuilder {
    builderClient.whereRaw(`COALESCE(??, '') NOT LIKE ?`, [this.tableColumnRef, `%${value}%`]);
    return builderClient;
  }

  isNoneOfOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IFilterValue
  ): Knex.QueryBuilder {
    const valueList = literalValueListSchema.parse(value);

    const sql = `COALESCE(??, '') NOT IN (${this.createSqlPlaceholders(valueList)})`;
    builderClient.whereRaw(sql, [this.tableColumnRef, ...valueList]);
    return builderClient;
  }
}
