import { isFieldReferenceValue, type IFilterOperator, type IFilterValue } from '@teable/core';
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

    const tableColumnRef = this.tableColumnRef;

    if (value) {
      // Filter for checked/true: match exactly true values
      builderClient.whereRaw(`${tableColumnRef} = true`);
    } else {
      // Filter for unchecked/false: match false values OR null values
      // This handles both formula fields (which return false) and checkbox fields (which store null)
      builderClient.where(function () {
        this.whereRaw(`${tableColumnRef} = false`);
        this.orWhereRaw(`${tableColumnRef} is null`);
      });
    }

    return builderClient;
  }
}
