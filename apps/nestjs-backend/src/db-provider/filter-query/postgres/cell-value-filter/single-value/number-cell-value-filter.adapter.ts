import type { IFilterOperator, ILiteralValue } from '@teable/core';
import type { Knex } from 'knex';
import type { IDbProvider } from '../../../../db.provider.interface';
import { CellValueFilterPostgres } from '../cell-value-filter.postgres';

export class NumberCellValueFilterAdapter extends CellValueFilterPostgres {
  isOperatorHandler(
    builderClient: Knex.QueryBuilder,
    operator: IFilterOperator,
    value: ILiteralValue,
    dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    return super.isOperatorHandler(builderClient, operator, value, dbProvider);
  }

  isNotOperatorHandler(
    builderClient: Knex.QueryBuilder,
    operator: IFilterOperator,
    value: ILiteralValue,
    dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    return super.isNotOperatorHandler(builderClient, operator, value, dbProvider);
  }

  isGreaterOperatorHandler(
    builderClient: Knex.QueryBuilder,
    operator: IFilterOperator,
    value: ILiteralValue,
    dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    return super.isGreaterOperatorHandler(builderClient, operator, value, dbProvider);
  }

  isGreaterEqualOperatorHandler(
    builderClient: Knex.QueryBuilder,
    operator: IFilterOperator,
    value: ILiteralValue,
    dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    return super.isGreaterEqualOperatorHandler(builderClient, operator, value, dbProvider);
  }

  isLessOperatorHandler(
    builderClient: Knex.QueryBuilder,
    operator: IFilterOperator,
    value: ILiteralValue,
    dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    return super.isLessOperatorHandler(builderClient, operator, value, dbProvider);
  }

  isLessEqualOperatorHandler(
    builderClient: Knex.QueryBuilder,
    operator: IFilterOperator,
    value: ILiteralValue,
    dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    return super.isLessEqualOperatorHandler(builderClient, operator, value, dbProvider);
  }
}
