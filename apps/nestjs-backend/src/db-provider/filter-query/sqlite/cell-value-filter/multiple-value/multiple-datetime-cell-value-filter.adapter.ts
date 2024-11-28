/* eslint-disable sonarjs/no-identical-functions */
import type { IDateFieldOptions, IDateFilter, IFilterOperator } from '@teable/core';
import type { Knex } from 'knex';
import { CellValueFilterSqlite } from '../cell-value-filter.sqlite';

export class MultipleDatetimeCellValueFilterAdapter extends CellValueFilterSqlite {
  isOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IDateFilter
  ): Knex.QueryBuilder {
    const { options } = this.field;

    const dateTimeRange = this.getFilterDateTimeRange(options as IDateFieldOptions, value);
    const sql = `exists ( 
      select 1 from 
        json_each(${this.tableColumnRef}) 
      where json_each.value between ? and ?
    )`;
    builderClient.whereRaw(sql, [...dateTimeRange]);
    return builderClient;
  }

  isNotOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IDateFilter
  ): Knex.QueryBuilder {
    const { options } = this.field;

    const dateTimeRange = this.getFilterDateTimeRange(options as IDateFieldOptions, value);
    const sql = `not exists ( 
      select 1 from 
        json_each(${this.tableColumnRef}) 
      where json_each.value between ? and ?
    )`;
    builderClient.whereRaw(sql, [...dateTimeRange]);
    return builderClient;
  }

  isGreaterOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IDateFilter
  ): Knex.QueryBuilder {
    const { options } = this.field;

    const dateTimeRange = this.getFilterDateTimeRange(options as IDateFieldOptions, value);
    const sql = `exists ( 
      select 1 from 
        json_each(${this.tableColumnRef}) 
      where json_each.value > ?
    )`;
    builderClient.whereRaw(sql, [dateTimeRange[1]]);
    return builderClient;
  }

  isGreaterEqualOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IDateFilter
  ): Knex.QueryBuilder {
    const { options } = this.field;

    const dateTimeRange = this.getFilterDateTimeRange(options as IDateFieldOptions, value);
    const sql = `exists ( 
      select 1 from 
        json_each(${this.tableColumnRef}) 
      where json_each.value >= ?
    )`;
    builderClient.whereRaw(sql, [dateTimeRange[0]]);
    return builderClient;
  }

  isLessOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IDateFilter
  ): Knex.QueryBuilder {
    const { options } = this.field;

    const dateTimeRange = this.getFilterDateTimeRange(options as IDateFieldOptions, value);
    const sql = `exists ( 
      select 1 from 
        json_each(${this.tableColumnRef}) 
      where json_each.value < ?
    )`;
    builderClient.whereRaw(sql, [dateTimeRange[0]]);
    return builderClient;
  }

  isLessEqualOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IDateFilter
  ): Knex.QueryBuilder {
    const { options } = this.field;

    const dateTimeRange = this.getFilterDateTimeRange(options as IDateFieldOptions, value);
    const sql = `exists ( 
      select 1 from 
        json_each(${this.tableColumnRef}) 
      where json_each.value <= ?
    )`;
    builderClient.whereRaw(sql, [dateTimeRange[1]]);
    return builderClient;
  }

  isWithInOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IDateFilter
  ): Knex.QueryBuilder {
    const { options } = this.field;

    const dateTimeRange = this.getFilterDateTimeRange(options as IDateFieldOptions, value);
    const sql = `exists ( 
      select 1 from 
        json_each(${this.tableColumnRef}) 
      where json_each.value between ? and ?
    )`;
    builderClient.whereRaw(sql, [...dateTimeRange]);
    return builderClient;
  }
}
