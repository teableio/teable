import type { IFilterOperator, IFilterValue } from '@teable/core';
import type { Knex } from 'knex';
import { CellValueFilterPostgres } from '../cell-value-filter.postgres';
import { BooleanCellValueFilterAdapter } from '../single-value/boolean-cell-value-filter.adapter';

export class MultipleBooleanCellValueFilterAdapter extends CellValueFilterPostgres {
  isOperatorHandler(
    builderClient: Knex.QueryBuilder,
    operator: IFilterOperator,
    value: IFilterValue
  ): Knex.QueryBuilder {
    return new BooleanCellValueFilterAdapter(this.field).isOperatorHandler(
      builderClient,
      operator,
      value
    );
  }
}
