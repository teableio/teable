import type {
  IFilterOperator,
  IFilterValue,
  ILiteralValue,
  ILiteralValueList,
} from '@teable-group/core';
import { FieldType } from '@teable-group/core';
import type { Knex } from 'knex';
import type { IFieldInstance } from '../../../../../features/field/model/factory';
import { CellValueFilterPostgres } from '../cell-value-filter.postgres';

export class JsonCellValueFilterAdapter extends CellValueFilterPostgres {
  isOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: ILiteralValue }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    if (field.type === FieldType.Link || field.type === FieldType.User) {
      queryBuilder.whereRaw(`??::jsonb @\\? '$.id \\? (@ == "${value}")'`, [field.dbFieldName]);
    } else {
      queryBuilder.whereRaw(`??::jsonb @\\? '$[*] \\? (@ == "${value}")'`, [field.dbFieldName]);
    }
    return queryBuilder;
  }

  isNotOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: ILiteralValue }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    if (field.type === FieldType.Link || field.type === FieldType.User) {
      queryBuilder.whereRaw(`NOT COALESCE(??, '{}')::jsonb @\\? '$.id \\? (@ == "${value}")'`, [
        field.dbFieldName,
      ]);
    } else {
      queryBuilder.whereRaw(`NOT COALESCE(??, '[]')::jsonb @\\? '$[*] \\? (@ == "${value}")'`, [
        field.dbFieldName,
      ]);
    }
    return queryBuilder;
  }

  isAnyOfOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: ILiteralValueList }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    if (field.type === FieldType.Link || field.type === FieldType.User) {
      queryBuilder.whereRaw(
        `jsonb_extract_path_text(??::jsonb, 'id') IN (${this.createSqlPlaceholders(value)})`,
        [field.dbFieldName, ...value]
      );
    } else {
      queryBuilder.whereRaw(`??::jsonb \\?| ARRAY[${this.createSqlPlaceholders(value)}]`, [
        field.dbFieldName,
        ...value,
      ]);
    }
    return queryBuilder;
  }

  isNoneOfOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: ILiteralValueList }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    if (field.type === FieldType.Link || field.type === FieldType.User) {
      queryBuilder.whereRaw(
        `COALESCE(jsonb_extract_path_text(COALESCE(??, '{}')::jsonb, 'id'), '') NOT IN (${this.createSqlPlaceholders(
          value
        )})`,
        [field.dbFieldName, ...value]
      );
    } else {
      queryBuilder.whereRaw(
        `NOT COALESCE(??, '[]')::jsonb \\?| ARRAY[${this.createSqlPlaceholders(value)}]`,
        [field.dbFieldName, ...value]
      );
    }
    return queryBuilder;
  }

  containsOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: IFilterValue }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    if (field.type === FieldType.Link) {
      queryBuilder.whereRaw(`??::jsonb @\\? '$.title \\? (@ like_regex "${value}" flag "i")'`, [
        field.dbFieldName,
      ]);
    } else {
      queryBuilder.whereRaw(`??::jsonb @\\? '$[*] \\? (@ like_regex "${value}" flag "i")'`, [
        field.dbFieldName,
      ]);
    }
    return queryBuilder;
  }

  doesNotContainOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: IFilterValue }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    if (field.type === FieldType.Link) {
      queryBuilder.whereRaw(
        `NOT COALESCE(??, '{}')::jsonb @\\? '$.title \\? (@ like_regex "${value}" flag "i")'`,
        [field.dbFieldName]
      );
    } else {
      queryBuilder.whereRaw(
        `NOT COALESCE(??, '[]')::jsonb @\\? '$[*] \\? (@ like_regex "${value}" flag "i")'`,
        [field.dbFieldName]
      );
    }
    return queryBuilder;
  }
}
