import type { IFilterOperator, ILiteralValue, ILiteralValueList } from '@teable/core';
import type { Knex } from 'knex';
import { size } from 'lodash';
import { CellValueFilterSqlite } from '../cell-value-filter.sqlite';

export class MultipleJsonCellValueFilterAdapter extends CellValueFilterSqlite {
  isOperatorHandler(
    builderClient: Knex.QueryBuilder,
    operator: IFilterOperator,
    value: ILiteralValueList
  ): Knex.QueryBuilder {
    const jsonColumn = this.getJsonQueryColumn(this.field, operator);
    const isOfSql = `exists (select 1 from json_each(??) where lower(??) = lower(?))`;
    builderClient.whereRaw(isOfSql, [this.tableColumnRef, jsonColumn, value]);
    return builderClient;
  }

  isNotOperatorHandler(
    builderClient: Knex.QueryBuilder,
    operator: IFilterOperator,
    value: ILiteralValueList
  ): Knex.QueryBuilder {
    const jsonColumn = this.getJsonQueryColumn(this.field, operator);
    const isNotOfSql = `not exists (select 1 from json_each(??) where lower(??) = lower(?))`;
    builderClient.whereRaw(isNotOfSql, [this.tableColumnRef, jsonColumn, value]);
    return builderClient;
  }

  isExactlyOperatorHandler(
    builderClient: Knex.QueryBuilder,
    operator: IFilterOperator,
    value: ILiteralValueList
  ): Knex.QueryBuilder {
    const jsonColumn = this.getJsonQueryColumn(this.field, operator);
    const isExactlySql = `(
      select count(${jsonColumn}) from 
        json_each(${this.tableColumnRef}) 
      where ${jsonColumn} in (${this.createSqlPlaceholders(value)})
    ) >= ?`;

    const isFullMatchSql = `(
      select count(distinct ${jsonColumn}) from 
        json_each(${this.tableColumnRef})
    ) = ?`;

    builderClient
      .whereRaw(isExactlySql, [...value, value.length])
      .whereRaw(isFullMatchSql, [value.length]);
    return builderClient;
  }

  isAnyOfOperatorHandler(
    builderClient: Knex.QueryBuilder,
    operator: IFilterOperator,
    value: ILiteralValueList
  ): Knex.QueryBuilder {
    const jsonColumn = this.getJsonQueryColumn(this.field, operator);
    const hasAnyOfSql = `exists (
      select 1 from 
        json_each(${this.tableColumnRef})
      where ${jsonColumn} in (${this.createSqlPlaceholders(value)})
    )`;
    builderClient.whereRaw(hasAnyOfSql, [...value]);
    return builderClient;
  }

  isNoneOfOperatorHandler(
    builderClient: Knex.QueryBuilder,
    operator: IFilterOperator,
    value: ILiteralValueList
  ): Knex.QueryBuilder {
    const jsonColumn = this.getJsonQueryColumn(this.field, operator);
    const hasNoneOfSql = `not exists (
      select 1 from 
        json_each(${this.tableColumnRef})
      where ${jsonColumn} in (${this.createSqlPlaceholders(value)})
    )`;
    builderClient.whereRaw(hasNoneOfSql, [...value]);
    return builderClient;
  }

  hasAllOfOperatorHandler(
    builderClient: Knex.QueryBuilder,
    operator: IFilterOperator,
    value: ILiteralValueList
  ): Knex.QueryBuilder {
    const jsonColumn = this.getJsonQueryColumn(this.field, operator);
    const hasAllSql = `(
      select count(distinct json_each.value) from 
        json_each(${this.tableColumnRef}) 
      where ${jsonColumn} in (${this.createSqlPlaceholders(value)})
    ) = ?`;
    builderClient.whereRaw(hasAllSql, [...value, size(value)]);
    return builderClient;
  }

  isNotExactlyOperatorHandler(
    builderClient: Knex.QueryBuilder,
    operator: IFilterOperator,
    value: ILiteralValueList
  ): Knex.QueryBuilder {
    const jsonColumn = this.getJsonQueryColumn(this.field, operator);
    const isNotExactlySql = `NOT ((
      select count(${jsonColumn}) from 
        json_each(${this.tableColumnRef}) 
      where ${jsonColumn} in (${this.createSqlPlaceholders(value)})
    ) >= ? AND (
      select count(distinct ${jsonColumn}) from 
        json_each(${this.tableColumnRef})
    ) = ?)`;

    builderClient.whereRaw(isNotExactlySql, [...value, value.length, value.length]);
    return builderClient;
  }

  containsOperatorHandler(
    builderClient: Knex.QueryBuilder,
    operator: IFilterOperator,
    value: ILiteralValue
  ): Knex.QueryBuilder {
    const sql = `exists (
      select 1 from
        json_each(${this.tableColumnRef})
      where ${this.getJsonQueryColumn(this.field, operator)} like ?
    )`;
    builderClient.whereRaw(sql, [`%${value}%`]);
    return builderClient;
  }

  doesNotContainOperatorHandler(
    builderClient: Knex.QueryBuilder,
    operator: IFilterOperator,
    value: ILiteralValue
  ): Knex.QueryBuilder {
    const sql = `not exists (
      select 1 from
        json_each(${this.tableColumnRef})
      where ${this.getJsonQueryColumn(this.field, operator)} like ?
    )`;
    builderClient.whereRaw(sql, [`%${value}%`]);
    return builderClient;
  }
}
