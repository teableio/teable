/* eslint-disable sonarjs/no-identical-functions */
import {
  TimeFormatting,
  type IDateFieldOptions,
  type IDateFilter,
  type IFilterOperator,
} from '@teable/core';
import type { Knex } from 'knex';
import { CellValueFilterSqlite } from '../cell-value-filter.sqlite';

export class DatetimeCellValueFilterAdapter extends CellValueFilterSqlite {
  isOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IDateFilter
  ): Knex.QueryBuilder {
    const { options } = this.field;

    const {
      formatting: { time },
    } = options as IDateFieldOptions;

    const dateTimeRange = this.getFilterDateTimeRange(options as IDateFieldOptions, value);

    if (time === TimeFormatting.None) {
      builderClient.whereBetween(this.tableColumnRef, dateTimeRange);
    } else {
      builderClient.whereRaw(
        `strftime('%Y-%m-%d %H:%M', ??) BETWEEN strftime('%Y-%m-%d %H:%M', ?) AND strftime('%Y-%m-%d %H:%M', ?)`,
        [this.tableColumnRef, dateTimeRange[0], dateTimeRange[1]]
      );
    }
    return builderClient;
  }

  isNotOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IDateFilter
  ): Knex.QueryBuilder {
    const { options } = this.field;

    const {
      formatting: { time },
    } = options as IDateFieldOptions;

    const dateTimeRange = this.getFilterDateTimeRange(options as IDateFieldOptions, value);

    if (time === TimeFormatting.None) {
      builderClient
        .whereNotBetween(this.tableColumnRef, dateTimeRange)
        .orWhereNull(this.tableColumnRef);
    } else {
      builderClient
        .whereRaw(
          `strftime('%Y-%m-%d %H:%M', ??) NOT BETWEEN strftime('%Y-%m-%d %H:%M', ?) AND strftime('%Y-%m-%d %H:%M', ?)`,
          [this.tableColumnRef, dateTimeRange[0], dateTimeRange[1]]
        )
        .orWhereNull(this.tableColumnRef);
    }

    return builderClient;
  }

  isGreaterOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IDateFilter
  ): Knex.QueryBuilder {
    const { options } = this.field;

    const {
      formatting: { time },
    } = options as IDateFieldOptions;

    const dateTimeRange = this.getFilterDateTimeRange(options as IDateFieldOptions, value);
    if (time === TimeFormatting.None) {
      builderClient.where(this.tableColumnRef, '>', dateTimeRange[1]);
    } else {
      builderClient.whereRaw(`strftime('%Y-%m-%d %H:%M', ??) > strftime('%Y-%m-%d %H:%M', ?)`, [
        this.tableColumnRef,
        dateTimeRange[1],
      ]);
    }
    return builderClient;
  }

  isGreaterEqualOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IDateFilter
  ): Knex.QueryBuilder {
    const { options } = this.field;

    const {
      formatting: { time },
    } = options as IDateFieldOptions;

    const dateTimeRange = this.getFilterDateTimeRange(options as IDateFieldOptions, value);

    if (time === TimeFormatting.None) {
      builderClient.where(this.tableColumnRef, '>=', dateTimeRange[0]);
    } else {
      builderClient.whereRaw(`strftime('%Y-%m-%d %H:%M', ??) >= strftime('%Y-%m-%d %H:%M', ?)`, [
        this.tableColumnRef,
        dateTimeRange[0],
      ]);
    }
    return builderClient;
  }

  isLessOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IDateFilter
  ): Knex.QueryBuilder {
    const { options } = this.field;

    const {
      formatting: { time },
    } = options as IDateFieldOptions;

    const dateTimeRange = this.getFilterDateTimeRange(options as IDateFieldOptions, value);

    if (time === TimeFormatting.None) {
      builderClient.where(this.tableColumnRef, '<', dateTimeRange[0]);
    } else {
      builderClient.whereRaw(`strftime('%Y-%m-%d %H:%M', ??) < strftime('%Y-%m-%d %H:%M', ?)`, [
        this.tableColumnRef,
        dateTimeRange[0],
      ]);
    }
    return builderClient;
  }

  isLessEqualOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IDateFilter
  ): Knex.QueryBuilder {
    const { options } = this.field;

    const {
      formatting: { time },
    } = options as IDateFieldOptions;

    const dateTimeRange = this.getFilterDateTimeRange(options as IDateFieldOptions, value);

    if (time === TimeFormatting.None) {
      builderClient.where(this.tableColumnRef, '<=', dateTimeRange[1]);
    } else {
      builderClient.whereRaw(`strftime('%Y-%m-%d %H:%M', ??) <= strftime('%Y-%m-%d %H:%M', ?)`, [
        this.tableColumnRef,
        dateTimeRange[1],
      ]);
    }
    return builderClient;
  }

  isWithInOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IDateFilter
  ): Knex.QueryBuilder {
    const { options } = this.field;

    const dateTimeRange = this.getFilterDateTimeRange(options as IDateFieldOptions, value);
    builderClient.whereBetween(this.tableColumnRef, dateTimeRange);
    return builderClient;
  }
}
