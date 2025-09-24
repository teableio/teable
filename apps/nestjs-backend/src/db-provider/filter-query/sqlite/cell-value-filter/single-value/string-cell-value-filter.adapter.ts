import {
  CellValueType,
  isFieldReferenceValue,
  type IFieldReferenceValue,
  type IFilterOperator,
  type ILiteralValue,
} from '@teable/core';
import type { Knex } from 'knex';
import type { IDbProvider } from '../../../../db.provider.interface';
import { CellValueFilterSqlite } from '../cell-value-filter.sqlite';

export class StringCellValueFilterAdapter extends CellValueFilterSqlite {
  isOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue | IFieldReferenceValue,
    _dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    if (isFieldReferenceValue(value)) {
      const ref = this.resolveFieldReference(value);
      builderClient.whereRaw(`LOWER(${this.tableColumnRef}) = LOWER(${ref})`);
      return builderClient;
    }
    const parseValue = this.field.cellValueType === CellValueType.Number ? Number(value) : value;
    builderClient.whereRaw(`LOWER(${this.tableColumnRef}) = LOWER(?)`, [parseValue]);
    return builderClient;
  }

  isNotOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue | IFieldReferenceValue,
    _dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    const { cellValueType } = this.field;
    if (isFieldReferenceValue(value)) {
      const ref = this.resolveFieldReference(value);
      builderClient.whereRaw(`LOWER(ifnull(${this.tableColumnRef}, '')) != LOWER(${ref})`);
      return builderClient;
    }
    const parseValue = cellValueType === CellValueType.Number ? Number(value) : value;
    builderClient.whereRaw(`LOWER(ifnull(${this.tableColumnRef}, '')) != LOWER(?)`, [parseValue]);
    return builderClient;
  }

  containsOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue,
    dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    this.ensureLiteralValue(value, _operator);
    return super.containsOperatorHandler(builderClient, _operator, value, dbProvider);
  }

  doesNotContainOperatorHandler(
    builderClient: Knex.QueryBuilder,
    operator: IFilterOperator,
    value: ILiteralValue,
    dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    this.ensureLiteralValue(value, operator);
    return super.doesNotContainOperatorHandler(builderClient, operator, value, dbProvider);
  }
}
