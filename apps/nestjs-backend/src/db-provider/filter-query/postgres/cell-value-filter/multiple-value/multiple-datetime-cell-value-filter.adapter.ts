/* eslint-disable sonarjs/no-identical-functions */
import type { IDateFieldOptions, IDateFilter, IFilterOperator } from '@teable-group/core';
import type { Knex } from 'knex';
import type { IFieldInstance } from '../../../../../features/field/model/factory';
import { CellValueFilterPostgres } from '../cell-value-filter.postgres';

export class MultipleDatetimeCellValueFilterAdapter extends CellValueFilterPostgres {
  isOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: IDateFilter }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    const dateTimeRange = this.getFilterDateTimeRange(field.options as IDateFieldOptions, value);
    queryBuilder.whereRaw(
      `jsonb_path_exists(??::jsonb, '$[*] \\? (@ >= "${dateTimeRange[0]}" && @ <= "${dateTimeRange[1]}")')`,
      [field.dbFieldName]
    );
    return queryBuilder;
  }

  isNotOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: IDateFilter }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    const dateTimeRange = this.getFilterDateTimeRange(field.options as IDateFieldOptions, value);
    queryBuilder.whereRaw(
      `NOT jsonb_path_exists(??::jsonb, '$[*] \\? (@ >= "${dateTimeRange[0]}" && @ <= "${dateTimeRange[1]}")')`,
      [field.dbFieldName]
    );
    return queryBuilder;
  }

  isGreaterOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: IDateFilter }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    const dateTimeRange = this.getFilterDateTimeRange(field.options as IDateFieldOptions, value);
    queryBuilder.whereRaw(`jsonb_path_exists(??::jsonb, '$[*] \\? (@ > "${dateTimeRange[1]}")')`, [
      field.dbFieldName,
    ]);
    return queryBuilder;
  }

  isGreaterEqualOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: IDateFilter }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    const dateTimeRange = this.getFilterDateTimeRange(field.options as IDateFieldOptions, value);
    queryBuilder.whereRaw(`jsonb_path_exists(??::jsonb, '$[*] \\? (@ >= "${dateTimeRange[0]}")')`, [
      field.dbFieldName,
    ]);
    return queryBuilder;
  }

  isLessOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: IDateFilter }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    const dateTimeRange = this.getFilterDateTimeRange(field.options as IDateFieldOptions, value);
    queryBuilder.whereRaw(`jsonb_path_exists(??::jsonb, '$[*] \\? (@ < "${dateTimeRange[0]}")')`, [
      field.dbFieldName,
    ]);
    return queryBuilder;
  }

  isLessEqualOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: IDateFilter }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    const dateTimeRange = this.getFilterDateTimeRange(field.options as IDateFieldOptions, value);
    queryBuilder.whereRaw(`jsonb_path_exists(??::jsonb, '$[*] \\? (@ <= "${dateTimeRange[1]}")')`, [
      field.dbFieldName,
    ]);
    return queryBuilder;
  }

  isWithInOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: IDateFilter }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    const dateTimeRange = this.getFilterDateTimeRange(field.options as IDateFieldOptions, value);
    queryBuilder.whereRaw(
      `jsonb_path_exists(??::jsonb, '$[*] \\? (@ >= "${dateTimeRange[0]}" && @ <= "${dateTimeRange[1]}")')`,
      [field.dbFieldName]
    );
    return queryBuilder;
  }
}
