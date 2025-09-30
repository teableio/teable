import { isFieldReferenceValue } from '@teable/core';
import type { IFilterOperator, IFilterValue } from '@teable/core';
import type { Knex } from 'knex';
import type { IDbProvider } from '../../../../db.provider.interface';
import { CellValueFilterSqlite } from '../cell-value-filter.sqlite';

export class BooleanCellValueFilterAdapter extends CellValueFilterSqlite {
  isOperatorHandler(
    builderClient: Knex.QueryBuilder,
    operator: IFilterOperator,
    value: IFilterValue,
    dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    if (isFieldReferenceValue(value)) {
      return super.isOperatorHandler(builderClient, operator, value, dbProvider);
    }
    return (value ? super.isNotEmptyOperatorHandler : super.isEmptyOperatorHandler).bind(this)(
      builderClient,
      operator,
      value,
      dbProvider
    );
  }
}
