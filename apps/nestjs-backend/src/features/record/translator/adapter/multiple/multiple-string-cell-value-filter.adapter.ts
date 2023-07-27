import type { IFilterOperator, ILiteralValue } from '@teable-group/core';
import type { Knex } from 'knex';
import type { IFieldInstance } from '../../../../field/model/factory';
import { AbstractCellValueFilter } from '../../abstract/cell-value-filter.abstract';

export class MultipleStringCellValueFilterAdapter extends AbstractCellValueFilter {
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
    queryBuilder.whereRaw(sql, [value]);
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
    queryBuilder.whereRaw(sql, [value]);
    return queryBuilder;
  }

  containsOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: ILiteralValue }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    const sql = `exists ( 
      select 1 from 
        json_each(${this._table}.${field.dbFieldName}) 
      where json_each.value like ?
    )`;
    queryBuilder.whereRaw(sql, [`%${value}%`]);
    return queryBuilder;
  }

  doesNotContainOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: ILiteralValue }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    const sql = `not exists ( 
      select 1 from 
        json_each(${this._table}.${field.dbFieldName}) 
      where json_each.value like ?
    )`;
    queryBuilder.whereRaw(sql, [`%${value}%`]);
    return queryBuilder;
  }
}
