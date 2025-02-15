import type { IFilterOperator, IFilterValue, ILiteralValue } from '@teable/core';
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

  isEmptyOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    _value: IFilterValue
  ): Knex.QueryBuilder {
    builderClient.where((builder) => {
      builder.whereNull(this.tableColumnRef).orWhere(this.tableColumnRef, '');
    });
    return builderClient;
  }

  isNotEmptyOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    _value: IFilterValue
  ): Knex.QueryBuilder {
    builderClient.where((builder) => {
      builder.whereNotNull(this.tableColumnRef).andWhereNot(this.tableColumnRef, '');
    });
    return builderClient;
  }
}
