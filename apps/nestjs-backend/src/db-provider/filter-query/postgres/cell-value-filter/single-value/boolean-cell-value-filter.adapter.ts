import type { IFilterOperator, IFilterValue } from '@teable/core';
import type { Knex } from 'knex';
import { CellValueFilterPostgres } from '../cell-value-filter.postgres';

export class BooleanCellValueFilterAdapter extends CellValueFilterPostgres {
  isOperatorHandler(
    builderClient: Knex.QueryBuilder,
    operator: IFilterOperator,
    value: IFilterValue
  ): Knex.QueryBuilder {
    return (value ? super.isNotEmptyOperatorHandler : super.isEmptyOperatorHandler).bind(this)(
      builderClient,
      operator,
      value
    );
  }
}
