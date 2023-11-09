import type { IFilterOperator, IFilterValue } from '@teable-group/core';
import type { Knex } from 'knex';
import type { IFieldInstance } from '../../../../../features/field/model/factory';
import { CellValueFilterSqlite } from '../cell-value-filter.sqlite';

export class BooleanCellValueFilterAdapter extends CellValueFilterSqlite {
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
