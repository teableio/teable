import type { IFilterOperator, ILiteralValue, ILiteralValueList } from '@teable-group/core';
import { FieldType } from '@teable-group/core';
import type { Knex } from 'knex';
import type { IFieldInstance } from '../../../../../features/field/model/factory';
import { CellValueFilterPostgres } from '../cell-value-filter.postgres';

export class MultipleJsonCellValueFilterAdapter extends CellValueFilterPostgres {
  isOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: ILiteralValueList }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    if (field.type === FieldType.Link) {
      const parseValue = JSON.stringify({ title: value });

      queryBuilder.whereRaw(`??::jsonb @> ?::jsonb`, [field.dbFieldName, parseValue]);
    } else {
      queryBuilder.whereRaw(`??::jsonb \\? ?`, [field.dbFieldName, value]);
    }
    return queryBuilder;
  }

  isNotOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: ILiteralValueList }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    if (field.type === FieldType.Link) {
      const parseValue = JSON.stringify({ title: value });

      queryBuilder.whereRaw(`NOT COALESCE(??, '[]')::jsonb @> ?::jsonb`, [
        field.dbFieldName,
        parseValue,
      ]);
    } else {
      queryBuilder.whereRaw(`NOT COALESCE(??, '[]')::jsonb \\? ?`, [field.dbFieldName, value]);
    }
    return queryBuilder;
  }

  isExactlyOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: ILiteralValueList }
  ): Knex.QueryBuilder {
    const { field, value } = params;
    const sqlPlaceholders = this.createSqlPlaceholders(value);

    if (field.type === FieldType.Link) {
      queryBuilder.whereRaw(
        `jsonb_path_query_array(??::jsonb, '$[*].id') @> to_jsonb(ARRAY[${sqlPlaceholders}]) AND to_jsonb(ARRAY[${sqlPlaceholders}]) @> jsonb_path_query_array(??::jsonb, '$[*].id')`,
        [field.dbFieldName, ...value, ...value, field.dbFieldName]
      );
    } else {
      queryBuilder.whereRaw(
        `??::jsonb @> to_jsonb(ARRAY[${sqlPlaceholders}]) AND to_jsonb(ARRAY[${sqlPlaceholders}]) @> ??::jsonb`,
        [field.dbFieldName, ...value, ...value, field.dbFieldName]
      );
    }
    return queryBuilder;
  }

  isAnyOfOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: ILiteralValueList }
  ): Knex.QueryBuilder {
    const { field, value } = params;
    const sqlPlaceholders = this.createSqlPlaceholders(value);

    if (field.type === FieldType.Link) {
      queryBuilder.whereRaw(
        `jsonb_path_query_array(??::jsonb, '$[*].id') \\?| ARRAY[${sqlPlaceholders}]`,
        [field.dbFieldName, ...value]
      );
    } else {
      queryBuilder.whereRaw(`??::jsonb \\?| ARRAY[${sqlPlaceholders}]`, [
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
    const sqlPlaceholders = this.createSqlPlaceholders(value);

    if (field.type === FieldType.Link) {
      queryBuilder.whereRaw(
        `NOT jsonb_path_query_array(COALESCE(??, '[]')::jsonb, '$[*].id') \\?| ARRAY[${sqlPlaceholders}]`,
        [field.dbFieldName, ...value]
      );
    } else {
      queryBuilder.whereRaw(`NOT COALESCE(??, '[]')::jsonb \\?| ARRAY[${sqlPlaceholders}]`, [
        field.dbFieldName,
        ...value,
      ]);
    }
    return queryBuilder;
  }

  hasAllOfOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: ILiteralValueList }
  ): Knex.QueryBuilder {
    const { field, value } = params;
    const sqlPlaceholders = this.createSqlPlaceholders(value);

    if (field.type === FieldType.Link) {
      queryBuilder.whereRaw(
        `jsonb_path_query_array(??::jsonb, '$[*].id') @> to_jsonb(ARRAY[${sqlPlaceholders}])`,
        [field.dbFieldName, ...value]
      );
    } else {
      queryBuilder.whereRaw(`??::jsonb @> to_jsonb(ARRAY[${sqlPlaceholders}])`, [
        field.dbFieldName,
        ...value,
      ]);
    }
    return queryBuilder;
  }

  containsOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: ILiteralValue }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    if (field.type === FieldType.Link) {
      queryBuilder.whereRaw(
        `jsonb_path_exists(??::jsonb, '$[*] \\? (@.title like_regex "${value}" flag "i")')`,
        [field.dbFieldName]
      );
    } else {
      queryBuilder.whereRaw(
        `jsonb_path_exists(??::jsonb, '$[*] \\? (@ like_regex "${value}" flag "i")')`,
        [field.dbFieldName]
      );
    }
    return queryBuilder;
  }

  doesNotContainOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: ILiteralValue }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    if (field.type === FieldType.Link) {
      queryBuilder.whereRaw(
        `NOT jsonb_path_exists(COALESCE(??, '[]')::jsonb, '$[*] \\? (@.title like_regex "${value}" flag "i")')`,
        [field.dbFieldName]
      );
    } else {
      queryBuilder.whereRaw(
        `NOT jsonb_path_exists(COALESCE(??, '[]')::jsonb, '$[*] \\? (@ like_regex "${value}" flag "i")')`,
        [field.dbFieldName]
      );
    }
    return queryBuilder;
  }
}
