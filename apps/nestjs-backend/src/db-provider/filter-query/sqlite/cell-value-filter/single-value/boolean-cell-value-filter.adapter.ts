import type { IFilterOperator, IFilterValue } from '@teable/core';
import type { Knex } from 'knex';
import { CellValueFilterSqlite } from '../cell-value-filter.sqlite';

export class BooleanCellValueFilterAdapter extends CellValueFilterSqlite {
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
