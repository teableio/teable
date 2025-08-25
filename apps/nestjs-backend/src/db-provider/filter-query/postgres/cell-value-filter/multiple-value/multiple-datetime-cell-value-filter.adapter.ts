/* eslint-disable sonarjs/no-identical-functions */
import type { IDateFieldOptions, IDateFilter, IFilterOperator } from '@teable/core';
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
      `${this.tableColumnRef}::jsonb @\\? '$[*] \\? (@ >= "${dateTimeRange[0]}" && @ <= "${dateTimeRange[1]}")'`
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
      `(NOT ${this.tableColumnRef}::jsonb @\\? '$[*] \\? (@ >= "${dateTimeRange[0]}" && @ <= "${dateTimeRange[1]}")' OR ${this.tableColumnRef} IS NULL)`
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
    builderClient.whereRaw(
      `${this.tableColumnRef}::jsonb @\\? '$[*] \\? (@ > "${dateTimeRange[1]}")'`
    );
    return builderClient;
  }

  isGreaterEqualOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IDateFilter
  ): Knex.QueryBuilder {
    const { options } = this.field;

    const dateTimeRange = this.getFilterDateTimeRange(options as IDateFieldOptions, value);
    builderClient.whereRaw(
      `${this.tableColumnRef}::jsonb @\\? '$[*] \\? (@ >= "${dateTimeRange[0]}")'`
    );
    return builderClient;
  }

  isLessOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IDateFilter
  ): Knex.QueryBuilder {
    const { options } = this.field;

    const dateTimeRange = this.getFilterDateTimeRange(options as IDateFieldOptions, value);
    builderClient.whereRaw(
      `${this.tableColumnRef}::jsonb @\\? '$[*] \\? (@ < "${dateTimeRange[0]}")'`
    );
    return builderClient;
  }

  isLessEqualOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IDateFilter
  ): Knex.QueryBuilder {
    const { options } = this.field;

    const dateTimeRange = this.getFilterDateTimeRange(options as IDateFieldOptions, value);
    builderClient.whereRaw(
      `${this.tableColumnRef}::jsonb @\\? '$[*] \\? (@ <= "${dateTimeRange[1]}")'`
    );
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
      `${this.tableColumnRef}::jsonb @\\? '$[*] \\? (@ >= "${dateTimeRange[0]}" && @ <= "${dateTimeRange[1]}")'`
    );
    return builderClient;
  }
}
