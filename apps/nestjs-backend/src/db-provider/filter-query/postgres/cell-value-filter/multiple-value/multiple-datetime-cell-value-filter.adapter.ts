/* eslint-disable sonarjs/no-identical-functions */
import {
  TimeFormatting,
  type IDateFieldOptions,
  type IDateFilter,
  type IFilterOperator,
} from '@teable/core';
import type { Knex } from 'knex';
import { CellValueFilterPostgres } from '../cell-value-filter.postgres';

export class MultipleDatetimeCellValueFilterAdapter extends CellValueFilterPostgres {
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
      builderClient.whereRaw(
        `??::jsonb @\\? '$[*] \\? (@ >= "${dateTimeRange[0]}" && @ <= "${dateTimeRange[1]}")'`,
        [this.tableColumnRef]
      );
    } else {
      builderClient.whereRaw(
        `(exists (select 1 from jsonb_array_elements_text( ?? :: jsonb ) as elem
          where date_trunc('minute', elem::timestamp) >= date_trunc('minute', ? :: timestamp) AND
          date_trunc('minute', elem::timestamp) <= date_trunc('minute', ? :: timestamp))
        )`,
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
        .whereRaw(
          `NOT ??::jsonb @\\? '$[*] \\? (@ >= "${dateTimeRange[0]}" && @ <= "${dateTimeRange[1]}")'`,
          [this.tableColumnRef]
        )
        .orWhereNull(this.tableColumnRef);
    } else {
      builderClient.whereRaw(
        `(not exists (select 1 from jsonb_array_elements_text( ?? :: jsonb ) as elem
            where date_trunc('minute', elem::timestamp) >= date_trunc('minute', ? :: timestamp) AND
            date_trunc('minute', elem::timestamp) <= date_trunc('minute', ? :: timestamp))
        )`,
        [this.tableColumnRef, dateTimeRange[0], dateTimeRange[1]]
      );
    }
    console.log('builderClient', builderClient.toQuery());

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
      builderClient.whereRaw(`??::jsonb @\\? '$[*] \\? (@ > "${dateTimeRange[1]}")'`, [
        this.tableColumnRef,
      ]);
    } else {
      builderClient.whereRaw(
        `(exists (select 1 from jsonb_array_elements_text( ?? :: jsonb ) as elem
          where date_trunc('minute', elem::timestamp) > date_trunc('minute', ? :: timestamp)))`,
        [this.tableColumnRef, dateTimeRange[1]]
      );
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
      builderClient.whereRaw(`??::jsonb @\\? '$[*] \\? (@ >= "${dateTimeRange[0]}")'`, [
        this.tableColumnRef,
      ]);
    } else {
      builderClient.whereRaw(
        `(exists (select 1 from jsonb_array_elements_text( ?? :: jsonb ) as elem
          where date_trunc('minute', elem::timestamp) >= date_trunc('minute', ? :: timestamp)))`,
        [this.tableColumnRef, dateTimeRange[0]]
      );
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
      builderClient.whereRaw(`??::jsonb @\\? '$[*] \\? (@ < "${dateTimeRange[0]}")'`, [
        this.tableColumnRef,
      ]);
    } else {
      builderClient.whereRaw(
        `(exists (select 1 from jsonb_array_elements_text( ?? :: jsonb ) as elem
          where date_trunc('minute', elem::timestamp) < date_trunc('minute', ? :: timestamp)))`,
        [this.tableColumnRef, dateTimeRange[0]]
      );
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
      builderClient.whereRaw(`??::jsonb @\\? '$[*] \\? (@ <= "${dateTimeRange[1]}")'`, [
        this.tableColumnRef,
      ]);
    } else {
      builderClient.whereRaw(
        `(exists (select 1 from jsonb_array_elements_text( ?? :: jsonb ) as elem
          where date_trunc('minute', elem::timestamp) <= date_trunc('minute', ? :: timestamp)))`,
        [this.tableColumnRef, dateTimeRange[1]]
      );
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
    builderClient.whereRaw(
      `??::jsonb @\\? '$[*] \\? (@ >= "${dateTimeRange[0]}" && @ <= "${dateTimeRange[1]}")'`,
      [this.tableColumnRef]
    );
    return builderClient;
  }
}
