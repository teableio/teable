import { CellValueType, type IFilterOperator, type ILiteralValue } from '@teable/core';
import type { Knex } from 'knex';
import { CellValueFilterPostgres } from '../cell-value-filter.postgres';

export class StringCellValueFilterAdapter extends CellValueFilterPostgres {
  isOperatorHandler(
    builderClient: Knex.QueryBuilder,
    operator: IFilterOperator,
    value: ILiteralValue
  ): Knex.QueryBuilder {
    const parseValue = this.field.cellValueType === CellValueType.Number ? Number(value) : value;
    builderClient.whereRaw('LOWER(??) = LOWER(?)', [this.tableColumnRef, parseValue]);
    return builderClient;
  }

  isNotOperatorHandler(
    builderClient: Knex.QueryBuilder,
    operator: IFilterOperator,
    value: ILiteralValue
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
    operator: IFilterOperator,
    value: ILiteralValue
  ): Knex.QueryBuilder {
    builderClient.where(this.tableColumnRef, 'iLIKE', `%${value}%`);
    return builderClient;
  }

  doesNotContainOperatorHandler(
    builderClient: Knex.QueryBuilder,
    operator: IFilterOperator,
    value: ILiteralValue
  ): Knex.QueryBuilder {
    builderClient.whereRaw(`LOWER(COALESCE(??, '')) NOT LIKE LOWER(?)`, [
      this.tableColumnRef,
      `%${value}%`,
    ]);
    return builderClient;
  }
}
