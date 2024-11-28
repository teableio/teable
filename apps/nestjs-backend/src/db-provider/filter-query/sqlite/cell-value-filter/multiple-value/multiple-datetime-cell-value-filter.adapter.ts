/* eslint-disable sonarjs/no-identical-functions */
import {
  TimeFormatting,
  type IDateFieldOptions,
  type IDateFilter,
  type IFilterOperator,
} from '@teable/core';
import type { Knex } from 'knex';
import { CellValueFilterSqlite } from '../cell-value-filter.sqlite';

export class MultipleDatetimeCellValueFilterAdapter extends CellValueFilterSqlite {
  isOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IDateFilter
  ): Knex.QueryBuilder {
    const { options } = this.field;

    const {
      formatting: { time },
    } = options as IDateFieldOptions;

    const dateTimeRange = this.getFilterDateTimeRange(options as IDateFieldOptions, value);
    if (time === TimeFormatting.None) {
      const sql = `exists ( 
        select 1 from 
          json_each(${this.tableColumnRef}) 
        where json_each.value between ? and ?
      )`;
      builderClient.whereRaw(sql, [...dateTimeRange]);
    } else {
      const sql = `exists ( 
        select 1 from 
          json_each(${this.tableColumnRef}) 
        where strftime('%Y-%m-%d-%H-%M', json_each.value) between strftime('%Y-%m-%d-%H-%M', ?) and strftime('%Y-%m-%d-%H-%M', ?)
      )`;
      builderClient.whereRaw(sql, [...dateTimeRange]);
    }

    return builderClient;
  }

  isNotOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IDateFilter
  ): Knex.QueryBuilder {
    const { options } = this.field;

    const {
      formatting: { time },
    } = options as IDateFieldOptions;

    const dateTimeRange = this.getFilterDateTimeRange(options as IDateFieldOptions, value);

    if (time === TimeFormatting.None) {
      const sql = `not exists ( 
        select 1 from 
          json_each(${this.tableColumnRef}) 
        where json_each.value between ? and ?
      )`;
      builderClient.whereRaw(sql, [...dateTimeRange]);
    } else {
      const sql = `not exists ( 
        select 1 from 
          json_each(${this.tableColumnRef}) 
        where strftime('%Y-%m-%d-%H-%M', json_each.value) between strftime('%Y-%m-%d-%H-%M', ?) and strftime('%Y-%m-%d-%H-%M', ?)
      )`;
      builderClient.whereRaw(sql, [...dateTimeRange]);
    }
    return builderClient;
  }

  isGreaterOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IDateFilter
  ): Knex.QueryBuilder {
    const { options } = this.field;

    const {
      formatting: { time },
    } = options as IDateFieldOptions;

    const dateTimeRange = this.getFilterDateTimeRange(options as IDateFieldOptions, value);
    if (time === TimeFormatting.None) {
      const sql = `exists ( 
        select 1 from 
          json_each(${this.tableColumnRef}) 
        where json_each.value > ?
      )`;
      builderClient.whereRaw(sql, [dateTimeRange[1]]);
    } else {
      const sql = `exists ( 
        select 1 from 
          json_each(${this.tableColumnRef}) 
        where strftime('%Y-%m-%d-%H-%M', json_each.value) > strftime('%Y-%m-%d-%H-%M', ?)
      )`;
      builderClient.whereRaw(sql, [dateTimeRange[1]]);
    }
    return builderClient;
  }

  isGreaterEqualOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IDateFilter
  ): Knex.QueryBuilder {
    const { options } = this.field;

    const {
      formatting: { time },
    } = options as IDateFieldOptions;

    const dateTimeRange = this.getFilterDateTimeRange(options as IDateFieldOptions, value);

    if (time === TimeFormatting.None) {
      const sql = `exists ( 
        select 1 from 
          json_each(${this.tableColumnRef}) 
        where json_each.value >= ?
      )`;
      builderClient.whereRaw(sql, [dateTimeRange[0]]);
    } else {
      const sql = `exists ( 
        select 1 from 
          json_each(${this.tableColumnRef}) 
        where strftime('%Y-%m-%d-%H-%M', json_each.value) >= strftime('%Y-%m-%d-%H-%M', ?)
      )`;
      builderClient.whereRaw(sql, [dateTimeRange[0]]);
    }
    return builderClient;
  }

  isLessOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IDateFilter
  ): Knex.QueryBuilder {
    const { options } = this.field;

    const {
      formatting: { time },
    } = options as IDateFieldOptions;

    const dateTimeRange = this.getFilterDateTimeRange(options as IDateFieldOptions, value);

    if (time === TimeFormatting.None) {
      const sql = `exists ( 
        select 1 from 
          json_each(${this.tableColumnRef}) 
        where json_each.value < ?
      )`;
      builderClient.whereRaw(sql, [dateTimeRange[0]]);
    } else {
      const sql = `exists ( 
        select 1 from 
          json_each(${this.tableColumnRef}) 
        where strftime('%Y-%m-%d-%H-%M', json_each.value) < strftime('%Y-%m-%d-%H-%M', ?)
      )`;
      builderClient.whereRaw(sql, [dateTimeRange[0]]);
    }
    return builderClient;
  }

  isLessEqualOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IDateFilter
  ): Knex.QueryBuilder {
    const { options } = this.field;

    const {
      formatting: { time },
    } = options as IDateFieldOptions;

    const dateTimeRange = this.getFilterDateTimeRange(options as IDateFieldOptions, value);

    if (time === TimeFormatting.None) {
      const sql = `exists ( 
        select 1 from 
          json_each(${this.tableColumnRef}) 
        where json_each.value <= ?
      )`;
      builderClient.whereRaw(sql, [dateTimeRange[1]]);
    } else {
      const sql = `exists ( 
        select 1 from 
          json_each(${this.tableColumnRef}) 
        where strftime('%Y-%m-%d-%H-%M', json_each.value) <= strftime('%Y-%m-%d-%H-%M', ?)
      )`;
      builderClient.whereRaw(sql, [dateTimeRange[1]]);
    }

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
