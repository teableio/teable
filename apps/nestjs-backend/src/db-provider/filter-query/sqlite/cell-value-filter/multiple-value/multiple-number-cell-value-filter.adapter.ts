import type { IFilterOperator, ILiteralValue } from '@teable-group/core';
import type { Knex } from 'knex';
import type { IFieldInstance } from '../../../../../features/field/model/factory';
import { CellValueFilterSqlite } from '../cell-value-filter.sqlite';

export class MultipleNumberCellValueFilterAdapter extends CellValueFilterSqlite {
  isOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: ILiteralValue }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    const sql = `exists ( 
      select 1 from 
        json_each(${this._table}.${field.dbFieldName}) 
      where json_each.value in (?)
    )`;
    queryBuilder.whereRaw(sql, [Number(value)]);
    return queryBuilder;
  }

  isNotOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: ILiteralValue }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    const sql = `not exists ( 
      select 1 from 
        json_each(${this._table}.${field.dbFieldName}) 
      where json_each.value in (?)
    )`;
    queryBuilder.whereRaw(sql, [Number(value)]);
    return queryBuilder;
  }

  isGreaterOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: ILiteralValue }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    const sql = `exists ( 
      select 1 from 
        json_each(${this._table}.${field.dbFieldName}) 
      where json_each.value > ?
    )`;
    queryBuilder.whereRaw(sql, [Number(value)]);
    return queryBuilder;
  }

  isGreaterEqualOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: ILiteralValue }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    const sql = `exists ( 
      select 1 from 
        json_each(${this._table}.${field.dbFieldName}) 
      where json_each.value >= ?
    )`;
    queryBuilder.whereRaw(sql, [Number(value)]);
    return queryBuilder;
  }

  isLessOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: ILiteralValue }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    const sql = `exists ( 
      select 1 from 
        json_each(${this._table}.${field.dbFieldName}) 
      where json_each.value < ?
    )`;
    queryBuilder.whereRaw(sql, [Number(value)]);
    return queryBuilder;
  }

  isLessEqualOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: ILiteralValue }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    const sql = `exists ( 
      select 1 from 
        json_each(${this._table}.${field.dbFieldName}) 
      where json_each.value <= ?
    )`;
    queryBuilder.whereRaw(sql, [Number(value)]);
    return queryBuilder;
  }
}
