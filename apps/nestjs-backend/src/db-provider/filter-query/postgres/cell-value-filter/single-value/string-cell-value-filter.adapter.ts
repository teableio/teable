import { CellValueType, type IFilterOperator, type ILiteralValue } from '@teable/core';
import type { Knex } from 'knex';
import type { IDbProvider } from '../../../../db.provider.interface';
import { CellValueFilterPostgres } from '../cell-value-filter.postgres';

export class StringCellValueFilterAdapter extends CellValueFilterPostgres {
  isOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue,
    _dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    const parseValue = this.field.cellValueType === CellValueType.Number ? Number(value) : value;
    builderClient.whereRaw('LOWER(??) = LOWER(?)', [this.tableColumnRef, parseValue]);
    return builderClient;
  }

  isNotOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue,
    _dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    const { cellValueType } = this.field;
    const parseValue = cellValueType === CellValueType.Number ? Number(value) : value;
    builderClient.whereRaw(`LOWER(??) IS DISTINCT FROM LOWER(?)`, [
      this.tableColumnRef,
      parseValue,
    ]);
    return builderClient;
  }

  containsOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue,
    _dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    builderClient.where(this.tableColumnRef, 'iLIKE', `%${value}%`);
    return builderClient;
  }

  doesNotContainOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue,
    _dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    builderClient.whereRaw(`LOWER(COALESCE(??, '')) NOT LIKE LOWER(?)`, [
      this.tableColumnRef,
      `%${value}%`,
    ]);
    return builderClient;
  }
}
