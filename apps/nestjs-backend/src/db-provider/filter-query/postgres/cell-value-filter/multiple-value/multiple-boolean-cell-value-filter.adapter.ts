import type { IFilterOperator, IFilterValue } from '@teable-group/core';
import type { Knex } from 'knex';
import type { IFieldInstance } from '../../../../../features/field/model/factory';
import { CellValueFilterPostgres } from '../cell-value-filter.postgres';
import { BooleanCellValueFilterAdapter } from '../single-value/boolean-cell-value-filter.adapter';

export class MultipleBooleanCellValueFilterAdapter extends CellValueFilterPostgres {
  isOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: IFilterValue }
  ): Knex.QueryBuilder {
    return new BooleanCellValueFilterAdapter(
      this.queryBuilder,
      this.fields,
      this.filter
    ).isOperatorHandler(queryBuilder, params);
  }
}
