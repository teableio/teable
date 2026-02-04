import {
  CellValueType,
  isFieldReferenceValue,
  type IFieldReferenceValue,
  type IFilterOperator,
  type ILiteralValue,
} from '@teable/core';
import type { Knex } from 'knex';
import { escapeLikeWildcards } from '../../../../../utils/sql-like-escape';
import type { IDbProvider } from '../../../../db.provider.interface';
import { CellValueFilterPostgres } from '../cell-value-filter.postgres';

export class StringCellValueFilterAdapter extends CellValueFilterPostgres {
  isOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue | IFieldReferenceValue,
    _dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    if (isFieldReferenceValue(value)) {
      const ref = this.resolveFieldReference(value);
      builderClient.whereRaw(`${this.tableColumnRef} = ${ref}`);
      return builderClient;
    }
    const parseValue = this.field.cellValueType === CellValueType.Number ? Number(value) : value;
    builderClient.whereRaw(`${this.tableColumnRef} = ?`, [parseValue]);
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
      builderClient.whereRaw(`${this.tableColumnRef} IS DISTINCT FROM ${ref}`);
      return builderClient;
    }
    const parseValue = cellValueType === CellValueType.Number ? Number(value) : value;
    builderClient.whereRaw(`${this.tableColumnRef} IS DISTINCT FROM ?`, [parseValue]);
    return builderClient;
  }

  containsOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue,
    _dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    this.ensureLiteralValue(value, _operator);
    const escapedValue = escapeLikeWildcards(String(value));
    builderClient.whereRaw(`${this.tableColumnRef} iLIKE ? ESCAPE '\\'`, [`%${escapedValue}%`]);
    return builderClient;
  }

  doesNotContainOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue,
    _dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    this.ensureLiteralValue(value, _operator);
    const escapedValue = escapeLikeWildcards(String(value));
    builderClient.whereRaw(
      `LOWER(COALESCE(${this.tableColumnRef}, '')) NOT LIKE LOWER(?) ESCAPE '\\'`,
      [`%${escapedValue}%`]
    );
    return builderClient;
  }
}
