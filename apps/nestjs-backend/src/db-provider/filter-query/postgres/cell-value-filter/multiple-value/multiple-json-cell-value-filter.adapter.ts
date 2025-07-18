import type { IFilterOperator, ILiteralValue, ILiteralValueList } from '@teable/core';
import { FieldType } from '@teable/core';
import type { Knex } from 'knex';
import { isUserOrLink } from '../../../../../utils/is-user-or-link';
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

      builderClient.whereRaw(`??::jsonb @> ?::jsonb`, [this.tableColumnRef, parseValue]);
    } else {
      builderClient.whereRaw(
        `EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(??::jsonb) as elem 
        WHERE elem ~* ?
      )`,
        [this.tableColumnRef, `^${value}$`]
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

      builderClient.whereRaw(`NOT COALESCE(??, '[]')::jsonb @> ?::jsonb`, [
        this.tableColumnRef,
        parseValue,
      ]);
    } else {
      builderClient.whereRaw(
        `NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(??, '[]')::jsonb) as elem 
          WHERE elem ~* ?
        )`,
        [this.tableColumnRef, `^${value}$`]
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
        `jsonb_path_query_array(??::jsonb, '$[*].id') @> to_jsonb(ARRAY[${sqlPlaceholders}]) AND to_jsonb(ARRAY[${sqlPlaceholders}]) @> jsonb_path_query_array(??::jsonb, '$[*].id')`,
        [this.tableColumnRef, ...value, ...value, this.tableColumnRef]
      );
    } else {
      builderClient.whereRaw(
        `??::jsonb @> to_jsonb(ARRAY[${sqlPlaceholders}]) AND to_jsonb(ARRAY[${sqlPlaceholders}]) @> ??::jsonb`,
        [this.tableColumnRef, ...value, ...value, this.tableColumnRef]
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

    if (isUserOrLink(type)) {
      builderClient.whereRaw(
        `jsonb_path_query_array(??::jsonb, '$[*].id') \\?| ARRAY[${sqlPlaceholders}]`,
        [this.tableColumnRef, ...value]
      );
    } else {
      builderClient.whereRaw(`??::jsonb \\?| ARRAY[${sqlPlaceholders}]`, [
        this.tableColumnRef,
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

    if (isUserOrLink(type)) {
      builderClient.whereRaw(
        `NOT jsonb_path_query_array(COALESCE(??, '[]')::jsonb, '$[*].id') \\?| ARRAY[${sqlPlaceholders}]`,
        [this.tableColumnRef, ...value]
      );
    } else {
      builderClient.whereRaw(`NOT COALESCE(??, '[]')::jsonb \\?| ARRAY[${sqlPlaceholders}]`, [
        this.tableColumnRef,
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

    if (isUserOrLink(type)) {
      builderClient.whereRaw(
        `jsonb_path_query_array(??::jsonb, '$[*].id') @> to_jsonb(ARRAY[${sqlPlaceholders}])`,
        [this.tableColumnRef, ...value]
      );
    } else {
      builderClient.whereRaw(`??::jsonb @> to_jsonb(ARRAY[${sqlPlaceholders}])`, [
        this.tableColumnRef,
        ...value,
      ]);
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

    builderClient.where((builder) => {
      if (isUserOrLink(type)) {
        builder
          .whereRaw(
            `NOT (jsonb_path_query_array(COALESCE(??, '[]')::jsonb, '$[*].id') @> to_jsonb(ARRAY[${sqlPlaceholders}]) AND to_jsonb(ARRAY[${sqlPlaceholders}]) @> jsonb_path_query_array(COALESCE(??, '[]')::jsonb, '$[*].id'))`,
            [this.tableColumnRef, ...value, ...value, this.tableColumnRef]
          )
          .orWhereNull(this.tableColumnRef);
      } else {
        builder
          .whereRaw(
            `NOT (COALESCE(??, '[]')::jsonb @> to_jsonb(ARRAY[${sqlPlaceholders}]) AND to_jsonb(ARRAY[${sqlPlaceholders}]) @> COALESCE(??, '[]')::jsonb)`,
            [this.tableColumnRef, ...value, ...value, this.tableColumnRef]
          )
          .orWhereNull(this.tableColumnRef);
      }
    });

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
        this.tableColumnRef,
      ]);
    } else {
      builderClient.whereRaw(`??::jsonb @\\? '$[*] \\? (@ like_regex "${value}" flag "i")'`, [
        this.tableColumnRef,
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
        [this.tableColumnRef]
      );
    } else {
      builderClient.whereRaw(
        `NOT COALESCE(??, '[]')::jsonb @\\? '$[*] \\? (@ like_regex "${value}" flag "i")'`,
        [this.tableColumnRef]
      );
    }
    return builderClient;
  }
}
