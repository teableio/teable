import { isFieldReferenceValue } from '@teable/core';
import type { IFilterOperator, IFilterValue } from '@teable/core';
import type { Knex } from 'knex';
import type { IDbProvider } from '../../../../db.provider.interface';
import { CellValueFilterPostgres } from '../cell-value-filter.postgres';

export class BooleanCellValueFilterAdapter extends CellValueFilterPostgres {
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
