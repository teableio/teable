import type { IFilterOperator, IFilterValue } from '@teable-group/core';
import type { Knex } from 'knex';
import type { IFieldInstance } from '../../../field/model/factory';
import { AbstractCellValueFilter } from '../abstract/cell-value-filter.abstract';

export class BooleanCellValueFilterAdapter extends AbstractCellValueFilter {
  isOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: IFilterValue }
  ): Knex.QueryBuilder {
    const { value } = params;
    return (value ? super.isNotEmptyOperatorHandler : super.isEmptyOperatorHandler)(
      queryBuilder,
      params
    );
  }
}
