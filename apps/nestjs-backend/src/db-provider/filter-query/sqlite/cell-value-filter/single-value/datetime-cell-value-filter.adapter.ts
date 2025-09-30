/* eslint-disable sonarjs/no-identical-functions */
import {
  isFieldReferenceValue,
  type IDateFieldOptions,
  type IDateFilter,
  type IFilterOperator,
  type IFilterValue,
} from '@teable/core';
import type { Knex } from 'knex';
import type { IDbProvider } from '../../../../db.provider.interface';
import { CellValueFilterSqlite } from '../cell-value-filter.sqlite';

export class DatetimeCellValueFilterAdapter extends CellValueFilterSqlite {
  isOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IFilterValue,
    dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    if (isFieldReferenceValue(value)) {
      return super.isOperatorHandler(builderClient, _operator, value, dbProvider);
    }

    const { options } = this.field;

    const dateTimeRange = this.getFilterDateTimeRange(
      options as IDateFieldOptions,
      value as IDateFilter
    );
    builderClient.whereRaw(`${this.tableColumnRef} BETWEEN ? AND ?`, dateTimeRange);
    return builderClient;
  }

  isNotOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IFilterValue,
    dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    if (isFieldReferenceValue(value)) {
      return super.isNotOperatorHandler(builderClient, _operator, value, dbProvider);
    }

    const { options } = this.field;

    const dateTimeRange = this.getFilterDateTimeRange(
      options as IDateFieldOptions,
      value as IDateFilter
    );
    builderClient.whereRaw(
      `(${this.tableColumnRef} NOT BETWEEN ? AND ? OR ${this.tableColumnRef} IS NULL)`,
      dateTimeRange
    );
    return builderClient;
  }

  isGreaterOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IFilterValue,
    dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    if (isFieldReferenceValue(value)) {
      return super.isGreaterOperatorHandler(builderClient, _operator, value, dbProvider);
    }

    const { options } = this.field;

    const dateTimeRange = this.getFilterDateTimeRange(
      options as IDateFieldOptions,
      value as IDateFilter
    );
    builderClient.whereRaw(`${this.tableColumnRef} > ?`, [dateTimeRange[1]]);
    return builderClient;
  }

  isGreaterEqualOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IFilterValue,
    dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    if (isFieldReferenceValue(value)) {
      return super.isGreaterEqualOperatorHandler(builderClient, _operator, value, dbProvider);
    }

    const { options } = this.field;

    const dateTimeRange = this.getFilterDateTimeRange(
      options as IDateFieldOptions,
      value as IDateFilter
    );
    builderClient.whereRaw(`${this.tableColumnRef} >= ?`, [dateTimeRange[0]]);
    return builderClient;
  }

  isLessOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IFilterValue,
    dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    if (isFieldReferenceValue(value)) {
      return super.isLessOperatorHandler(builderClient, _operator, value, dbProvider);
    }

    const { options } = this.field;

    const dateTimeRange = this.getFilterDateTimeRange(
      options as IDateFieldOptions,
      value as IDateFilter
    );
    builderClient.whereRaw(`${this.tableColumnRef} < ?`, [dateTimeRange[0]]);
    return builderClient;
  }

  isLessEqualOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IFilterValue,
    dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    if (isFieldReferenceValue(value)) {
      return super.isLessEqualOperatorHandler(builderClient, _operator, value, dbProvider);
    }

    const { options } = this.field;

    const dateTimeRange = this.getFilterDateTimeRange(
      options as IDateFieldOptions,
      value as IDateFilter
    );
    builderClient.whereRaw(`${this.tableColumnRef} <= ?`, [dateTimeRange[1]]);
    return builderClient;
  }

  isWithInOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IFilterValue,
    dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    if (isFieldReferenceValue(value)) {
      return super.isOperatorHandler(builderClient, _operator, value, dbProvider);
    }

    const { options } = this.field;

    const dateTimeRange = this.getFilterDateTimeRange(
      options as IDateFieldOptions,
      value as IDateFilter
    );
    builderClient.whereRaw(`${this.tableColumnRef} BETWEEN ? AND ?`, dateTimeRange);
    return builderClient;
  }
}
