import { CellValueType, type IFilterOperator, type ILiteralValue } from '@teable/core';
import type { Knex } from 'knex';
import type { IDbProvider } from '../../../../db.provider.interface';
import { CellValueFilterSqlite } from '../cell-value-filter.sqlite';

export class StringCellValueFilterAdapter extends CellValueFilterSqlite {
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
    dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    return super.containsOperatorHandler(builderClient, _operator, value, dbProvider);
  }

  doesNotContainOperatorHandler(
    builderClient: Knex.QueryBuilder,
    operator: IFilterOperator,
    value: ILiteralValue,
    dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    return super.doesNotContainOperatorHandler(builderClient, operator, value, dbProvider);
  }
}
