/* eslint-disable sonarjs/no-identical-functions */
import type { IDateFieldOptions, IDateFilter, IFilterOperator } from '@teable/core';
import type { Knex } from 'knex';
import { CellValueFilterSqlite } from '../cell-value-filter.sqlite';

export class DatetimeCellValueFilterAdapter extends CellValueFilterSqlite {
  isOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IDateFilter
  ): Knex.QueryBuilder {
    const { options } = this.field;

    const dateTimeRange = this.getFilterDateTimeRange(options as IDateFieldOptions, value);
    builderClient.whereBetween(this.columnName, dateTimeRange);
    return builderClient;
  }

  isNotOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IDateFilter
  ): Knex.QueryBuilder {
    const { options } = this.field;

    const dateTimeRange = this.getFilterDateTimeRange(options as IDateFieldOptions, value);
    builderClient.whereNotBetween(this.columnName, dateTimeRange);
    return builderClient;
  }

  isGreaterOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IDateFilter
  ): Knex.QueryBuilder {
    const { options } = this.field;

    const dateTimeRange = this.getFilterDateTimeRange(options as IDateFieldOptions, value);
    builderClient.where(this.columnName, '>', dateTimeRange[1]);
    return builderClient;
  }

  isGreaterEqualOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IDateFilter
  ): Knex.QueryBuilder {
    const { options } = this.field;

    const dateTimeRange = this.getFilterDateTimeRange(options as IDateFieldOptions, value);
    builderClient.where(this.columnName, '>=', dateTimeRange[0]);
    return builderClient;
  }

  isLessOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IDateFilter
  ): Knex.QueryBuilder {
    const { options } = this.field;

    const dateTimeRange = this.getFilterDateTimeRange(options as IDateFieldOptions, value);
    builderClient.where(this.columnName, '<', dateTimeRange[0]);
    return builderClient;
  }

  isLessEqualOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IDateFilter
  ): Knex.QueryBuilder {
    const { options } = this.field;

    const dateTimeRange = this.getFilterDateTimeRange(options as IDateFieldOptions, value);
    builderClient.where(this.columnName, '<=', dateTimeRange[1]);
    return builderClient;
  }

  isWithInOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IDateFilter
  ): Knex.QueryBuilder {
    const { options } = this.field;

    const dateTimeRange = this.getFilterDateTimeRange(options as IDateFieldOptions, value);
    builderClient.whereBetween(this.columnName, dateTimeRange);
    return builderClient;
  }
}
