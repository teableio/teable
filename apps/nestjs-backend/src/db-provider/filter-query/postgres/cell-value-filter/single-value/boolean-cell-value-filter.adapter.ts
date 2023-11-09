import type { IFilterOperator, IFilterValue } from '@teable-group/core';
import type { Knex } from 'knex';
import type { IFieldInstance } from '../../../../../features/field/model/factory';
import { CellValueFilterPostgres } from '../cell-value-filter.postgres';

export class BooleanCellValueFilterAdapter extends CellValueFilterPostgres {
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
