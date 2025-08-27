import type { IFilterOperator, ILiteralValue, ILiteralValueList } from '@teable/core';
import { FieldType } from '@teable/core';
import type { Knex } from 'knex';
import { isUserOrLink } from '../../../../../utils/is-user-or-link';
import { escapeJsonbRegex } from '../../../../../utils/postgres-regex-escape';
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

      builderClient.whereRaw(`${this.tableColumnRef}::jsonb @> ?::jsonb`, [parseValue]);
    } else {
      builderClient.whereRaw(
        `EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(${this.tableColumnRef}::jsonb) as elem
        WHERE elem ~* ?
      )`,
        [`^${value}$`]
      );
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

      builderClient.whereRaw(`NOT COALESCE(${this.tableColumnRef}, '[]')::jsonb @> ?::jsonb`, [
        parseValue,
      ]);
    } else {
      builderClient.whereRaw(
        `NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(${this.tableColumnRef}, '[]')::jsonb) as elem
          WHERE elem ~* ?
        )`,
        [`^${value}$`]
      );
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

    if (isUserOrLink(type)) {
      builderClient.whereRaw(
        `jsonb_path_query_array(${this.tableColumnRef}::jsonb, '$[*].id') @> to_jsonb(ARRAY[${sqlPlaceholders}]) AND to_jsonb(ARRAY[${sqlPlaceholders}]) @> jsonb_path_query_array(${this.tableColumnRef}::jsonb, '$[*].id')`,
        [...value, ...value]
      );
    } else {
      builderClient.whereRaw(
        `${this.tableColumnRef}::jsonb @> to_jsonb(ARRAY[${sqlPlaceholders}]) AND to_jsonb(ARRAY[${sqlPlaceholders}]) @> ${this.tableColumnRef}::jsonb`,
        [...value, ...value]
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

    if (isUserOrLink(type)) {
      builderClient.whereRaw(
        `jsonb_exists_any(jsonb_path_query_array(${this.tableColumnRef}::jsonb, '$[*].id'), ?::text[])`,
        [value]
      );
    } else {
      builderClient.whereRaw(`jsonb_exists_any(${this.tableColumnRef}::jsonb, ?::text[])`, [value]);
    }
    return builderClient;
  }

  isNoneOfOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValueList
  ): Knex.QueryBuilder {
    const { type } = this.field;

    if (isUserOrLink(type)) {
      builderClient.whereRaw(
        `NOT jsonb_exists_any(jsonb_path_query_array(COALESCE(${this.tableColumnRef}, '[]')::jsonb, '$[*].id'), ?::text[])`,
        [value]
      );
    } else {
      builderClient.whereRaw(
        `NOT jsonb_exists_any(COALESCE(${this.tableColumnRef}, '[]')::jsonb, ?::text[])`,
        [value]
      );
    }
    return builderClient;
  }

  hasAllOfOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValueList
  ): Knex.QueryBuilder {
    const { type } = this.field;

    if (isUserOrLink(type)) {
      builderClient.whereRaw(
        `jsonb_exists_all(jsonb_path_query_array(${this.tableColumnRef}::jsonb, '$[*].id'), ?::text[])`,
        [value]
      );
    } else {
      builderClient.whereRaw(`jsonb_exists_all(${this.tableColumnRef}::jsonb, ?::text[])`, [value]);
    }
    return builderClient;
  }

  isNotExactlyOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValueList
  ): Knex.QueryBuilder {
    const { type } = this.field;
    const sqlPlaceholders = this.createSqlPlaceholders(value);

    if (isUserOrLink(type)) {
      builderClient.whereRaw(
        `(NOT (jsonb_path_query_array(COALESCE(${this.tableColumnRef}, '[]')::jsonb, '$[*].id') @> to_jsonb(ARRAY[${sqlPlaceholders}]) AND to_jsonb(ARRAY[${sqlPlaceholders}]) @> jsonb_path_query_array(COALESCE(${this.tableColumnRef}, '[]')::jsonb, '$[*].id')) OR ${this.tableColumnRef} IS NULL)`,
        [...value, ...value]
      );
    } else {
      builderClient.whereRaw(
        `(NOT (COALESCE(${this.tableColumnRef}, '[]')::jsonb @> to_jsonb(ARRAY[${sqlPlaceholders}]) AND to_jsonb(ARRAY[${sqlPlaceholders}]) @> COALESCE(${this.tableColumnRef}, '[]')::jsonb) OR ${this.tableColumnRef} IS NULL)`,
        [...value, ...value]
      );
    }

    return builderClient;
  }

  containsOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue
  ): Knex.QueryBuilder {
    const { type } = this.field;
    const escapedValue = escapeJsonbRegex(String(value));

    if (type === FieldType.Link) {
      builderClient.whereRaw(
        `jsonb_path_exists(${this.tableColumnRef}::jsonb, '$[*] ? (@.title like_regex $v flag "i")', jsonb_build_object('v', ?))`,
        [String(escapedValue)]
      );
    } else {
      builderClient.whereRaw(
        `jsonb_path_exists(${this.tableColumnRef}::jsonb, '$[*] ? (@ like_regex $v flag "i")', jsonb_build_object('v', ?))`,
        [String(escapedValue)]
      );
    }
    return builderClient;
  }

  doesNotContainOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue
  ): Knex.QueryBuilder {
    const { type } = this.field;
    const escapedValue = escapeJsonbRegex(String(value));

    if (type === FieldType.Link) {
      builderClient.whereRaw(
        `NOT jsonb_path_exists(COALESCE(${this.tableColumnRef}, '[]')::jsonb, '$[*] ? (@.title like_regex $v flag "i")', jsonb_build_object('v', ?))`,
        [String(escapedValue)]
      );
    } else {
      builderClient.whereRaw(
        `NOT jsonb_path_exists(COALESCE(${this.tableColumnRef}, '[]')::jsonb, '$[*] ? (@ like_regex $v flag "i")', jsonb_build_object('v', ?))`,
        [String(escapedValue)]
      );
    }
    return builderClient;
  }
}
