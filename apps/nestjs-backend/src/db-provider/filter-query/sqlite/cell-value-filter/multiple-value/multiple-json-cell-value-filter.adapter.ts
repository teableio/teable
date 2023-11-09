import type { IFilterOperator, ILiteralValue, ILiteralValueList } from '@teable-group/core';
import type { Knex } from 'knex';
import { size } from 'lodash';
import type { IFieldInstance } from '../../../../../features/field/model/factory';
import { CellValueFilterSqlite } from '../cell-value-filter.sqlite';

export class MultipleJsonCellValueFilterAdapter extends CellValueFilterSqlite {
  isOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: ILiteralValueList }
  ): Knex.QueryBuilder {
    const { field, operator, value } = params;

    const jsonColumn = this.getJsonQueryColumn(field, operator);
    const isOfSql = `exists (select 1 from json_each(??) where ?? = ?)`;
    queryBuilder.whereRaw(isOfSql, [this.tableDbFieldName(field), jsonColumn, value]);
    return queryBuilder;
  }

  isNotOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: ILiteralValueList }
  ): Knex.QueryBuilder {
    const { field, operator, value } = params;

    const jsonColumn = this.getJsonQueryColumn(field, operator);
    const isNotOfSql = `not exists (select 1 from json_each(??) where ?? = ?)`;
    queryBuilder.whereRaw(isNotOfSql, [this.tableDbFieldName(field), jsonColumn, value]);
    return queryBuilder;
  }

  isExactlyOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: ILiteralValueList }
  ): Knex.QueryBuilder {
    const { field, operator, value } = params;

    const jsonColumn = this.getJsonQueryColumn(field, operator);
    const isExactlySql = `(
      select count(distinct json_each.value) from 
        json_each(${this._table}.${field.dbFieldName}) 
      where ${jsonColumn} in (${this.createSqlPlaceholders(value)})
        and json_array_length(${this._table}.${field.dbFieldName}) = ?
    ) = ?`;
    const vLength = value.length;
    queryBuilder.whereRaw(isExactlySql, [...value, vLength, vLength]);
    return queryBuilder;
  }

  isAnyOfOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: ILiteralValueList }
  ): Knex.QueryBuilder {
    const { field, operator, value } = params;

    const jsonColumn = this.getJsonQueryColumn(field, operator);
    const hasAnyOfSql = `exists (
      select 1 from 
        json_each(${this._table}.${field.dbFieldName})
      where ${jsonColumn} in (${this.createSqlPlaceholders(value)})
    )`;
    queryBuilder.whereRaw(hasAnyOfSql, [...value]);
    return queryBuilder;
  }

  isNoneOfOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: ILiteralValueList }
  ): Knex.QueryBuilder {
    const { field, operator, value } = params;

    const jsonColumn = this.getJsonQueryColumn(field, operator);
    const hasNoneOfSql = `not exists (
      select 1 from 
        json_each(${this._table}.${field.dbFieldName})
      where ${jsonColumn} in (${this.createSqlPlaceholders(value)})
    )`;
    queryBuilder.whereRaw(hasNoneOfSql, [...value]);
    return queryBuilder;
  }

  hasAllOfOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: ILiteralValueList }
  ): Knex.QueryBuilder {
    const { field, operator, value } = params;

    const jsonColumn = this.getJsonQueryColumn(field, operator);
    const hasAllSql = `(
      select count(distinct json_each.value) from 
        json_each(${this._table}.${field.dbFieldName}) 
      where ${jsonColumn} in (${this.createSqlPlaceholders(value)})
    ) = ?`;
    queryBuilder.whereRaw(hasAllSql, [...value, size(value)]);
    return queryBuilder;
  }

  containsOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: ILiteralValue }
  ): Knex.QueryBuilder {
    const { field, operator, value } = params;

    const sql = `exists (
      select 1 from
        json_each(${this._table}.${field.dbFieldName})
      where ${this.getJsonQueryColumn(field, operator)} like ?
    )`;
    queryBuilder.whereRaw(sql, [`%${value}%`]);
    return queryBuilder;
  }

  doesNotContainOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: ILiteralValue }
  ): Knex.QueryBuilder {
    const { field, operator, value } = params;

    const sql = `not exists (
      select 1 from
        json_each(${this._table}.${field.dbFieldName})
      where ${this.getJsonQueryColumn(field, operator)} like ?
    )`;
    queryBuilder.whereRaw(sql, [`%${value}%`]);
    return queryBuilder;
  }
}
