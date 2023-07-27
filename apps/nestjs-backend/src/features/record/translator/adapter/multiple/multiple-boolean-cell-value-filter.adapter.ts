import type { IFilterOperator, IFilterValue } from '@teable-group/core';
import type { Knex } from 'knex';
import type { IFieldInstance } from '../../../../field/model/factory';
import { AbstractCellValueFilter } from '../../abstract/cell-value-filter.abstract';
import { BooleanCellValueFilterAdapter } from '../boolean-cell-value-filter.adapter';

export class MultipleBooleanCellValueFilterAdapter extends AbstractCellValueFilter {
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
