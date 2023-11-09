import type { IFilterOperator, ILiteralValue } from '@teable-group/core';
import type { Knex } from 'knex';
import type { IFieldInstance } from '../../../../../features/field/model/factory';
import { CellValueFilterPostgres } from '../cell-value-filter.postgres';

export class MultipleNumberCellValueFilterAdapter extends CellValueFilterPostgres {
  isOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: ILiteralValue }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    queryBuilder.whereRaw(`jsonb_path_exists(??::jsonb, '$[*] \\? (@ == ?)' )`, [
      field.dbFieldName,
      Number(value),
    ]);
    return queryBuilder;
  }

  isNotOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: ILiteralValue }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    queryBuilder.whereRaw(
      `jsonb_path_exists(COALESCE(??, '[null]')::jsonb, '$[*] \\? (@ != ?)' )`,
      [field.dbFieldName, Number(value)]
    );
    return queryBuilder;
  }

  isGreaterOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: ILiteralValue }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    queryBuilder.whereRaw(`jsonb_path_exists(??::jsonb, '$[*] \\? (@ > ?)')`, [
      field.dbFieldName,
      Number(value),
    ]);
    return queryBuilder;
  }

  isGreaterEqualOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: ILiteralValue }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    queryBuilder.whereRaw(`jsonb_path_exists(??::jsonb, '$[*] \\? (@ >= ?)')`, [
      field.dbFieldName,
      Number(value),
    ]);
    return queryBuilder;
  }

  isLessOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: ILiteralValue }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    queryBuilder.whereRaw(`jsonb_path_exists(??::jsonb, '$[*] \\? (@ < ?)')`, [
      field.dbFieldName,
      Number(value),
    ]);
    return queryBuilder;
  }

  isLessEqualOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: ILiteralValue }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    queryBuilder.whereRaw(`jsonb_path_exists(??::jsonb, '$[*] \\? (@ <= ?)')`, [
      field.dbFieldName,
      Number(value),
    ]);
    return queryBuilder;
  }
}
