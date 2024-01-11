import type { IFilterOperator, ILiteralValue, ILiteralValueList } from '@teable-group/core';
import { FieldType } from '@teable-group/core';
import type { Knex } from 'knex';
import { CellValueFilterPostgres } from '../cell-value-filter.postgres';

export class MultipleJsonCellValueFilterAdapter extends CellValueFilterPostgres {
  isOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValueList
  ): Knex.QueryBuilder {
    const { type } = this.field;

    if (type === FieldType.Link) {
      const parseValue = JSON.stringify({ title: value });

      builderClient.whereRaw(`??::jsonb @> ?::jsonb`, [this.columnName, parseValue]);
    } else {
      builderClient.whereRaw(`??::jsonb \\? ?`, [this.columnName, value]);
    }
    return builderClient;
  }

  isNotOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValueList
  ): Knex.QueryBuilder {
    const { type } = this.field;

    if (type === FieldType.Link) {
      const parseValue = JSON.stringify({ title: value });

      builderClient.whereRaw(`NOT COALESCE(??, '[]')::jsonb @> ?::jsonb`, [
        this.columnName,
        parseValue,
      ]);
    } else {
      builderClient.whereRaw(`NOT COALESCE(??, '[]')::jsonb \\? ?`, [this.columnName, value]);
    }
    return builderClient;
  }

  isExactlyOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValueList
  ): Knex.QueryBuilder {
    const { type } = this.field;
    const sqlPlaceholders = this.createSqlPlaceholders(value);

    if (type === FieldType.Link || type === FieldType.User) {
      builderClient.whereRaw(
        `jsonb_path_query_array(??::jsonb, '$[*].id') @> to_jsonb(ARRAY[${sqlPlaceholders}]) AND to_jsonb(ARRAY[${sqlPlaceholders}]) @> jsonb_path_query_array(??::jsonb, '$[*].id')`,
        [this.columnName, ...value, ...value, this.columnName]
      );
    } else {
      builderClient.whereRaw(
        `??::jsonb @> to_jsonb(ARRAY[${sqlPlaceholders}]) AND to_jsonb(ARRAY[${sqlPlaceholders}]) @> ??::jsonb`,
        [this.columnName, ...value, ...value, this.columnName]
      );
    }
    return builderClient;
  }

  isAnyOfOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValueList
  ): Knex.QueryBuilder {
    const { type } = this.field;
    const sqlPlaceholders = this.createSqlPlaceholders(value);

    if (type === FieldType.Link || type === FieldType.User) {
      builderClient.whereRaw(
        `jsonb_path_query_array(??::jsonb, '$[*].id') \\?| ARRAY[${sqlPlaceholders}]`,
        [this.columnName, ...value]
      );
    } else {
      builderClient.whereRaw(`??::jsonb \\?| ARRAY[${sqlPlaceholders}]`, [
        this.columnName,
        ...value,
      ]);
    }
    return builderClient;
  }

  isNoneOfOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValueList
  ): Knex.QueryBuilder {
    const { type } = this.field;
    const sqlPlaceholders = this.createSqlPlaceholders(value);

    if (type === FieldType.Link || type === FieldType.User) {
      builderClient.whereRaw(
        `NOT jsonb_path_query_array(COALESCE(??, '[]')::jsonb, '$[*].id') \\?| ARRAY[${sqlPlaceholders}]`,
        [this.columnName, ...value]
      );
    } else {
      builderClient.whereRaw(`NOT COALESCE(??, '[]')::jsonb \\?| ARRAY[${sqlPlaceholders}]`, [
        this.columnName,
        ...value,
      ]);
    }
    return builderClient;
  }

  hasAllOfOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValueList
  ): Knex.QueryBuilder {
    const { type } = this.field;
    const sqlPlaceholders = this.createSqlPlaceholders(value);

    if (type === FieldType.Link || type === FieldType.User) {
      builderClient.whereRaw(
        `jsonb_path_query_array(??::jsonb, '$[*].id') @> to_jsonb(ARRAY[${sqlPlaceholders}])`,
        [this.columnName, ...value]
      );
    } else {
      builderClient.whereRaw(`??::jsonb @> to_jsonb(ARRAY[${sqlPlaceholders}])`, [
        this.columnName,
        ...value,
      ]);
    }
    return builderClient;
  }

  containsOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue
  ): Knex.QueryBuilder {
    const { type } = this.field;

    if (type === FieldType.Link) {
      builderClient.whereRaw(`??::jsonb @\\? '$[*] \\? (@.title like_regex "${value}" flag "i")'`, [
        this.columnName,
      ]);
    } else {
      builderClient.whereRaw(`??::jsonb @\\? '$[*] \\? (@ like_regex "${value}" flag "i")'`, [
        this.columnName,
      ]);
    }
    return builderClient;
  }

  doesNotContainOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue
  ): Knex.QueryBuilder {
    const { type } = this.field;

    if (type === FieldType.Link) {
      builderClient.whereRaw(
        `NOT COALESCE(??, '[]')::jsonb @\\? '$[*] \\? (@.title like_regex "${value}" flag "i")'`,
        [this.columnName]
      );
    } else {
      builderClient.whereRaw(
        `NOT COALESCE(??, '[]')::jsonb @\\? '$[*] \\? (@ like_regex "${value}" flag "i")'`,
        [this.columnName]
      );
    }
    return builderClient;
  }
}
