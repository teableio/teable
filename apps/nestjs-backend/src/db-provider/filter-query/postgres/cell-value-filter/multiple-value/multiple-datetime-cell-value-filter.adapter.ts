/* eslint-disable sonarjs/no-identical-functions */
import type { IDateFieldOptions, IDateFilter, IFilterOperator } from '@teable-group/core';
import type { Knex } from 'knex';
import { CellValueFilterPostgres } from '../cell-value-filter.postgres';

export class MultipleDatetimeCellValueFilterAdapter extends CellValueFilterPostgres {
  isOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IDateFilter
  ): Knex.QueryBuilder {
    const { options } = this.field;

    const dateTimeRange = this.getFilterDateTimeRange(options as IDateFieldOptions, value);
    builderClient.whereRaw(
      `??::jsonb @\\? '$[*] \\? (@ >= "${dateTimeRange[0]}" && @ <= "${dateTimeRange[1]}")'`,
      [this.columnName]
    );
    return builderClient;
  }

  isNotOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IDateFilter
  ): Knex.QueryBuilder {
    const { options } = this.field;

    const dateTimeRange = this.getFilterDateTimeRange(options as IDateFieldOptions, value);
    builderClient.whereRaw(
      `NOT ??::jsonb @\\? '$[*] \\? (@ >= "${dateTimeRange[0]}" && @ <= "${dateTimeRange[1]}")'`,
      [this.columnName]
    );
    return builderClient;
  }

  isGreaterOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IDateFilter
  ): Knex.QueryBuilder {
    const { options } = this.field;

    const dateTimeRange = this.getFilterDateTimeRange(options as IDateFieldOptions, value);
    builderClient.whereRaw(`??::jsonb @\\? '$[*] \\? (@ > "${dateTimeRange[1]}")'`, [
      this.columnName,
    ]);
    return builderClient;
  }

  isGreaterEqualOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IDateFilter
  ): Knex.QueryBuilder {
    const { options } = this.field;

    const dateTimeRange = this.getFilterDateTimeRange(options as IDateFieldOptions, value);
    builderClient.whereRaw(`??::jsonb @\\? '$[*] \\? (@ >= "${dateTimeRange[0]}")'`, [
      this.columnName,
    ]);
    return builderClient;
  }

  isLessOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IDateFilter
  ): Knex.QueryBuilder {
    const { options } = this.field;

    const dateTimeRange = this.getFilterDateTimeRange(options as IDateFieldOptions, value);
    builderClient.whereRaw(`??::jsonb @\\? '$[*] \\? (@ < "${dateTimeRange[0]}")'`, [
      this.columnName,
    ]);
    return builderClient;
  }

  isLessEqualOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IDateFilter
  ): Knex.QueryBuilder {
    const { options } = this.field;

    const dateTimeRange = this.getFilterDateTimeRange(options as IDateFieldOptions, value);
    builderClient.whereRaw(`??::jsonb @\\? '$[*] \\? (@ <= "${dateTimeRange[1]}")'`, [
      this.columnName,
    ]);
    return builderClient;
  }

  isWithInOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IDateFilter
  ): Knex.QueryBuilder {
    const { options } = this.field;

    const dateTimeRange = this.getFilterDateTimeRange(options as IDateFieldOptions, value);
    builderClient.whereRaw(
      `??::jsonb @\\? '$[*] \\? (@ >= "${dateTimeRange[0]}" && @ <= "${dateTimeRange[1]}")'`,
      [this.columnName]
    );
    return builderClient;
  }
}
