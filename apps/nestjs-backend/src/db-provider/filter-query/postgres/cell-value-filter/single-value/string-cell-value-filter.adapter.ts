import type { IFilterOperator, ILiteralValue } from '@teable/core';
import type { Knex } from 'knex';
import { CellValueFilterPostgres } from '../cell-value-filter.postgres';

export class StringCellValueFilterAdapter extends CellValueFilterPostgres {
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
    return super.doesNotContainOperatorHandler(builderClient, operator, value);
  }
}
