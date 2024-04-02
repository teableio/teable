import type { IFilterOperator, ILiteralValue } from '@teable/core';
import type { Knex } from 'knex';
import { CellValueFilterSqlite } from '../cell-value-filter.sqlite';

export class MultipleStringCellValueFilterAdapter extends CellValueFilterSqlite {
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
    builderClient.whereRaw(sql, [value]);
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
    builderClient.whereRaw(sql, [value]);
    return builderClient;
  }

  containsOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue
  ): Knex.QueryBuilder {
    const sql = `exists ( 
      select 1 from 
        json_each(${this.tableColumnRef}) 
      where json_each.value like ?
    )`;
    builderClient.whereRaw(sql, [`%${value}%`]);
    return builderClient;
  }

  doesNotContainOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue
  ): Knex.QueryBuilder {
    const sql = `not exists ( 
      select 1 from 
        json_each(${this.tableColumnRef}) 
      where json_each.value like ?
    )`;
    builderClient.whereRaw(sql, [`%${value}%`]);
    return builderClient;
  }
}
