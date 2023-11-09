import type { IFilterOperator, ILiteralValue } from '@teable-group/core';
import type { Knex } from 'knex';
import type { IFieldInstance } from '../../../../../features/field/model/factory';
import { CellValueFilterPostgres } from '../cell-value-filter.postgres';

export class MultipleStringCellValueFilterAdapter extends CellValueFilterPostgres {
  isOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: ILiteralValue }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    queryBuilder.whereRaw(`jsonb_path_exists(??::jsonb, '$[*] \\? (@ == "${value}")' )`, [
      field.dbFieldName,
    ]);
    return queryBuilder;
  }

  isNotOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: ILiteralValue }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    queryBuilder.whereRaw(
      `jsonb_path_exists(COALESCE(??, '[null]')::jsonb, '$[*] \\? (@ != "${value}")' )`,
      [field.dbFieldName]
    );
    return queryBuilder;
  }

  containsOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: ILiteralValue }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    queryBuilder.whereRaw(
      `jsonb_path_exists(??::jsonb, '$[*] \\? (@ like_regex "${value}" flag "i")')`,
      [field.dbFieldName]
    );
    return queryBuilder;
  }

  doesNotContainOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: ILiteralValue }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    queryBuilder.whereRaw(
      `NOT jsonb_path_exists(??::jsonb, '$[*] \\? (@ like_regex "${value}" flag "i")')`,
      [field.dbFieldName]
    );
    return queryBuilder;
  }
}
