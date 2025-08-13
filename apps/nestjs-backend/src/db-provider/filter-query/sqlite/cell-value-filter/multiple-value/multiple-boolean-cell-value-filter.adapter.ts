import type { IFilterOperator, IFilterValue } from '@teable/core';
import type { Knex } from 'knex';
import type { IDbProvider } from '../../../../db.provider.interface';
import { CellValueFilterSqlite } from '../cell-value-filter.sqlite';
import { BooleanCellValueFilterAdapter } from '../single-value/boolean-cell-value-filter.adapter';

export class MultipleBooleanCellValueFilterAdapter extends CellValueFilterSqlite {
  isOperatorHandler(
    builderClient: Knex.QueryBuilder,
    operator: IFilterOperator,
    value: IFilterValue,
    dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    return new BooleanCellValueFilterAdapter(this.field).isOperatorHandler(
      builderClient,
      operator,
      value,
      dbProvider
    );
  }
}
