import type { IFilterOperator, ILiteralValue } from '@teable/core';
import type { Knex } from 'knex';
import { CellValueFilterSqlite } from '../cell-value-filter.sqlite';

export class NumberCellValueFilterAdapter extends CellValueFilterSqlite {
  isOperatorHandler(
    builderClient: Knex.QueryBuilder,
    operator: IFilterOperator,
    value: ILiteralValue
  ): Knex.QueryBuilder {
    return super.isOperatorHandler(builderClient, operator, value);
  }

  isNotOperatorHandler(
    builderClient: Knex.QueryBuilder,
    operator: IFilterOperator,
    value: ILiteralValue
  ): Knex.QueryBuilder {
    return super.isNotOperatorHandler(builderClient, operator, value);
  }

  isGreaterOperatorHandler(
    builderClient: Knex.QueryBuilder,
    operator: IFilterOperator,
    value: ILiteralValue
  ): Knex.QueryBuilder {
    return super.isGreaterOperatorHandler(builderClient, operator, value);
  }

  isGreaterEqualOperatorHandler(
    builderClient: Knex.QueryBuilder,
    operator: IFilterOperator,
    value: ILiteralValue
  ): Knex.QueryBuilder {
    return super.isGreaterEqualOperatorHandler(builderClient, operator, value);
  }

  isLessOperatorHandler(
    builderClient: Knex.QueryBuilder,
    operator: IFilterOperator,
    value: ILiteralValue
  ): Knex.QueryBuilder {
    return super.isLessOperatorHandler(builderClient, operator, value);
  }

  isLessEqualOperatorHandler(
    builderClient: Knex.QueryBuilder,
    operator: IFilterOperator,
    value: ILiteralValue
  ): Knex.QueryBuilder {
    return super.isLessEqualOperatorHandler(builderClient, operator, value);
  }
}
