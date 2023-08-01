import type { IDateFilter, IFilterOperator, IDateFieldOptions } from '@teable-group/core';
import type { Knex } from 'knex';
import type { IFieldInstance } from '../../../../field/model/factory';
import { AbstractCellValueFilter } from '../../abstract/cell-value-filter.abstract';

export class MultipleDatetimeValueCellFilterAdapter extends AbstractCellValueFilter {
  isOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: IDateFilter }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    const dateTimeRange = this.getFilterDateTimeRange(field.options as IDateFieldOptions, value);
    const sql = `exists ( 
      select 1 from 
        json_each(${this._table}.${field.dbFieldName}) 
      where json_each.value between ? and ?
    )`;
    queryBuilder.whereRaw(sql, [...dateTimeRange]);
    return queryBuilder;
  }

  isNotOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: IDateFilter }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    const dateTimeRange = this.getFilterDateTimeRange(field.options as IDateFieldOptions, value);
    const sql = `not exists ( 
      select 1 from 
        json_each(${this._table}.${field.dbFieldName}) 
      where json_each.value between ? and ?
    )`;
    queryBuilder.whereRaw(sql, [...dateTimeRange]);
    return queryBuilder;
  }

  isGreaterOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: IDateFilter }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    const dateTimeRange = this.getFilterDateTimeRange(field.options as IDateFieldOptions, value);
    const sql = `exists ( 
      select 1 from 
        json_each(${this._table}.${field.dbFieldName}) 
      where json_each.value > ?
    )`;
    queryBuilder.whereRaw(sql, [dateTimeRange[1]]);
    return queryBuilder;
  }

  isGreaterEqualOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: IDateFilter }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    const dateTimeRange = this.getFilterDateTimeRange(field.options as IDateFieldOptions, value);
    const sql = `exists ( 
      select 1 from 
        json_each(${this._table}.${field.dbFieldName}) 
      where json_each.value >= ?
    )`;
    queryBuilder.whereRaw(sql, [dateTimeRange[0]]);
    return queryBuilder;
  }

  isLessOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: IDateFilter }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    const dateTimeRange = this.getFilterDateTimeRange(field.options as IDateFieldOptions, value);
    const sql = `exists ( 
      select 1 from 
        json_each(${this._table}.${field.dbFieldName}) 
      where json_each.value < ?
    )`;
    queryBuilder.whereRaw(sql, [dateTimeRange[0]]);
    return queryBuilder;
  }

  isLessEqualOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: IDateFilter }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    const dateTimeRange = this.getFilterDateTimeRange(field.options as IDateFieldOptions, value);
    const sql = `exists ( 
      select 1 from 
        json_each(${this._table}.${field.dbFieldName}) 
      where json_each.value <= ?
    )`;
    queryBuilder.whereRaw(sql, [dateTimeRange[1]]);
    return queryBuilder;
  }

  // eslint-disable-next-line sonarjs/no-identical-functions
  isWithInOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: IDateFilter }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    const dateTimeRange = this.getFilterDateTimeRange(field.options as IDateFieldOptions, value);
    const sql = `exists ( 
      select 1 from 
        json_each(${this._table}.${field.dbFieldName}) 
      where json_each.value between ? and ?
    )`;
    queryBuilder.whereRaw(sql, [...dateTimeRange]);
    return queryBuilder;
  }
}
