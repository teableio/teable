import type { IFilterOperator, ILiteralValue } from '@teable/core';
import type { Knex } from 'knex';
import { CellValueFilterSqlite } from '../cell-value-filter.sqlite';

export class MultipleNumberCellValueFilterAdapter extends CellValueFilterSqlite {
  isOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue
  ): Knex.QueryBuilder {
    const sql = `exists ( 
      select 1 from 
        json_each(${this.tableColumnRef}) 
      where json_each.value in (?)
    )`;
    builderClient.whereRaw(sql, [Number(value)]);
    return builderClient;
  }

  isNotOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue
  ): Knex.QueryBuilder {
    const sql = `not exists ( 
      select 1 from 
        json_each(${this.tableColumnRef}) 
      where json_each.value in (?)
    )`;
    builderClient.whereRaw(sql, [Number(value)]);
    return builderClient;
  }

  isGreaterOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue
  ): Knex.QueryBuilder {
    const sql = `exists ( 
      select 1 from 
        json_each(${this.tableColumnRef}) 
      where json_each.value > ?
    )`;
    builderClient.whereRaw(sql, [Number(value)]);
    return builderClient;
  }

  isGreaterEqualOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue
  ): Knex.QueryBuilder {
    const sql = `exists ( 
      select 1 from 
        json_each(${this.tableColumnRef}) 
      where json_each.value >= ?
    )`;
    builderClient.whereRaw(sql, [Number(value)]);
    return builderClient;
  }

  isLessOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue
  ): Knex.QueryBuilder {
    const sql = `exists ( 
      select 1 from 
        json_each(${this.tableColumnRef}) 
      where json_each.value < ?
    )`;
    builderClient.whereRaw(sql, [Number(value)]);
    return builderClient;
  }

  isLessEqualOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue
  ): Knex.QueryBuilder {
    const sql = `exists ( 
      select 1 from 
        json_each(${this.tableColumnRef}) 
      where json_each.value <= ?
    )`;
    builderClient.whereRaw(sql, [Number(value)]);
    return builderClient;
  }
}
