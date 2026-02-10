import { isFieldReferenceValue, type IFilterOperator, type IFilterValue } from '@teable/core';
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

    const tableColumnRef = this.tableColumnRef;

    if (value) {
      // Filter for checked/true: match exactly true values (stored as 1 in SQLite)
      builderClient.whereRaw(`${tableColumnRef} = 1`);
    } else {
      // Filter for unchecked/false: match false values OR null values
      // This handles both formula fields (which return false/0) and checkbox fields (which store null)
      builderClient.where(function () {
        this.whereRaw(`${tableColumnRef} = 0`);
        this.orWhereRaw(`${tableColumnRef} is null`);
      });
    }

    return builderClient;
  }
}
