import type { IDateFieldOptions, IDateFilter, IFilterOperator } from '@teable-group/core';
import type { Knex } from 'knex';
import type { IFieldInstance } from '../../../field/model/factory';
import { AbstractCellValueFilter } from '../abstract/cell-value-filter.abstract';

export class DatetimeCellValueFilterAdapter extends AbstractCellValueFilter {
  isOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: IDateFilter }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    const dateTimeRange = this.getFilterDateTimeRange(field.options as IDateFieldOptions, value);
    queryBuilder.whereBetween(field.dbFieldName, dateTimeRange);
    return queryBuilder;
  }

  isNotOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: IDateFilter }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    const dateTimeRange = this.getFilterDateTimeRange(field.options as IDateFieldOptions, value);
    queryBuilder.whereNotBetween(field.dbFieldName, dateTimeRange);
    return queryBuilder;
  }

  isGreaterOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: IDateFilter }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    const dateTimeRange = this.getFilterDateTimeRange(field.options as IDateFieldOptions, value);
    queryBuilder.where(field.dbFieldName, '>', dateTimeRange[1]);
    return queryBuilder;
  }

  isGreaterEqualOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: IDateFilter }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    const dateTimeRange = this.getFilterDateTimeRange(field.options as IDateFieldOptions, value);
    queryBuilder.where(field.dbFieldName, '>=', dateTimeRange[0]);
    return queryBuilder;
  }

  isLessOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: IDateFilter }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    const dateTimeRange = this.getFilterDateTimeRange(field.options as IDateFieldOptions, value);
    queryBuilder.where(field.dbFieldName, '<', dateTimeRange[0]);
    return queryBuilder;
  }

  isLessEqualOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: IDateFilter }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    const dateTimeRange = this.getFilterDateTimeRange(field.options as IDateFieldOptions, value);
    queryBuilder.where(field.dbFieldName, '<=', dateTimeRange[1]);
    return queryBuilder;
  }

  // eslint-disable-next-line sonarjs/no-identical-functions
  isWithInOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: IDateFilter }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    const dateTimeRange = this.getFilterDateTimeRange(field.options as IDateFieldOptions, value);
    queryBuilder.whereBetween(field.dbFieldName, dateTimeRange);
    return queryBuilder;
  }
}
