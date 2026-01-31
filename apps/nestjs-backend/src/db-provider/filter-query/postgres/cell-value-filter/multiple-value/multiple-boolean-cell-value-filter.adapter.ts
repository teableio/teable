import type { IFilterOperator, IFilterValue } from '@teable/core';
import { isFieldReferenceValue } from '@teable/core';
import type { Knex } from 'knex';
import type { IDbProvider } from '../../../../db.provider.interface';
import { CellValueFilterPostgres } from '../cell-value-filter.postgres';

export class MultipleBooleanCellValueFilterAdapter extends CellValueFilterPostgres {
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
      // Filter for checked/true: match JSONB arrays that contain at least one true value
      builderClient.whereRaw(`${tableColumnRef} @> '[true]'::jsonb`);
    } else {
      // Filter for unchecked/false: match records that do NOT contain any true value
      // This includes: null, empty arrays, or arrays with only false/null values
      builderClient.where(function () {
        this.whereRaw(`${tableColumnRef} is null`);
        this.orWhereRaw(`NOT (${tableColumnRef} @> '[true]'::jsonb)`);
      });
    }

    return builderClient;
  }
}
