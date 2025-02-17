import type { IFilterOperator, IFilterValue, ILiteralValue, ILiteralValueList } from '@teable/core';
import type { Knex } from 'knex';
import { CellValueFilterSqlite } from '../cell-value-filter.sqlite';

export class JsonCellValueFilterAdapter extends CellValueFilterSqlite {
  isOperatorHandler(
    builderClient: Knex.QueryBuilder,
    operator: IFilterOperator,
    value: ILiteralValue
  ): Knex.QueryBuilder {
    const jsonColumn = this.getJsonQueryColumn(this.field, operator);
    const sql = `lower(${jsonColumn}) = lower(?)`;
    builderClient.whereRaw(sql, [value]);
    return builderClient;
  }

  isNotOperatorHandler(
    builderClient: Knex.QueryBuilder,
    operator: IFilterOperator,
    value: ILiteralValue
  ): Knex.QueryBuilder {
    const jsonColumn = this.getJsonQueryColumn(this.field, operator);
    const sql = `lower(ifnull(${jsonColumn}, '')) != lower(?)`;
    builderClient.whereRaw(sql, [value]);
    return builderClient;
  }

  isAnyOfOperatorHandler(
    builderClient: Knex.QueryBuilder,
    operator: IFilterOperator,
    value: ILiteralValueList
  ): Knex.QueryBuilder {
    const jsonColumn = this.getJsonQueryColumn(this.field, operator);
    const sql = `${jsonColumn} in (${this.createSqlPlaceholders(value)})`;
    builderClient.whereRaw(sql, [...value]);
    return builderClient;
  }

  isNoneOfOperatorHandler(
    builderClient: Knex.QueryBuilder,
    operator: IFilterOperator,
    value: ILiteralValueList
  ): Knex.QueryBuilder {
    const jsonColumn = this.getJsonQueryColumn(this.field, operator);
    const sql = `ifnull(${jsonColumn}, '') not in (${this.createSqlPlaceholders(value)})`;
    builderClient.whereRaw(sql, [...value]);
    return builderClient;
  }

  containsOperatorHandler(
    builderClient: Knex.QueryBuilder,
    operator: IFilterOperator,
    value: IFilterValue
  ): Knex.QueryBuilder {
    const sql = `${this.getJsonQueryColumn(this.field, operator)} like ?`;
    builderClient.whereRaw(sql, [`%${value}%`]);
    return builderClient;
  }

  doesNotContainOperatorHandler(
    builderClient: Knex.QueryBuilder,
    operator: IFilterOperator,
    value: IFilterValue
  ): Knex.QueryBuilder {
    const sql = `ifnull(${this.getJsonQueryColumn(this.field, operator)}, '') not like ?`;
    builderClient.whereRaw(sql, [`%${value}%`]);
    return builderClient;
  }
}
