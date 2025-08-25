import type { IFilterOperator, IFilterValue } from '@teable/core';
import { CellValueType, literalValueListSchema } from '@teable/core';
import type { Knex } from 'knex';
import type { IDbProvider } from '../../../db.provider.interface';
import { AbstractCellValueFilter } from '../../cell-value-filter.abstract';

export class CellValueFilterPostgres extends AbstractCellValueFilter {
  isNotOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IFilterValue,
    _dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    const { cellValueType } = this.field;
    const parseValue = cellValueType === CellValueType.Number ? Number(value) : value;
    builderClient.whereRaw(`${this.tableColumnRef} IS DISTINCT FROM ?`, [parseValue]);
    return builderClient;
  }

  doesNotContainOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IFilterValue,
    _dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    builderClient.whereRaw(`COALESCE(${this.tableColumnRef}, '') NOT LIKE ?`, [`%${value}%`]);
    return builderClient;
  }

  isNoneOfOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IFilterValue,
    _dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    const valueList = literalValueListSchema.parse(value);

    const sql = `COALESCE(${this.tableColumnRef}, '') NOT IN (${this.createSqlPlaceholders(valueList)})`;
    builderClient.whereRaw(sql, valueList);
    return builderClient;
  }
}
