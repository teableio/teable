import type { IFilterOperator, IFilterValue } from '@teable/core';
import { isFieldReferenceValue } from '@teable/core';
import type { Knex } from 'knex';
import type { IDbProvider } from '../../../../db.provider.interface';
import { CellValueFilterSqlite } from '../cell-value-filter.sqlite';

export class MultipleBooleanCellValueFilterAdapter extends CellValueFilterSqlite {
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
      // Filter for checked/true: match JSON arrays that contain at least one true value (stored as 1)
      // Use json_each to check if any element equals 1 (true in SQLite)
      builderClient.whereRaw(
        `EXISTS (SELECT 1 FROM json_each(${tableColumnRef}) WHERE json_each.value = 1)`
      );
    } else {
      // Filter for unchecked/false: match records that do NOT contain any true value
      // This includes: null, empty arrays, or arrays with only false/null values
      builderClient.where(function () {
        this.whereRaw(`${tableColumnRef} is null`);
        this.orWhereRaw(
          `NOT EXISTS (SELECT 1 FROM json_each(${tableColumnRef}) WHERE json_each.value = 1)`
        );
      });
    }

    return builderClient;
  }
}
