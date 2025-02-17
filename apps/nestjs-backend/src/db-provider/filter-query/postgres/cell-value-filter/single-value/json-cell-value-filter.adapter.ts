import type { IFilterOperator, IFilterValue, ILiteralValue, ILiteralValueList } from '@teable/core';
import { FieldType } from '@teable/core';
import type { Knex } from 'knex';
import { isUserOrLink } from '../../../../../utils/is-user-or-link';
import { CellValueFilterPostgres } from '../cell-value-filter.postgres';

export class JsonCellValueFilterAdapter extends CellValueFilterPostgres {
  isOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue
  ): Knex.QueryBuilder {
    const { type } = this.field;

    if (isUserOrLink(type)) {
      builderClient.whereRaw(`??::jsonb @\\? '$.id \\? (@ == "${value}")'`, [this.tableColumnRef]);
    } else {
      builderClient.whereRaw(`??::jsonb @\\? '$[*] \\? (@ =~ "${value}" flag "i")'`, [
        this.tableColumnRef,
      ]);
    }
    return builderClient;
  }

  isNotOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue
  ): Knex.QueryBuilder {
    const { type } = this.field;

    if (isUserOrLink(type)) {
      builderClient.whereRaw(`NOT COALESCE(??, '{}')::jsonb @\\? '$.id \\? (@ == "${value}")'`, [
        this.tableColumnRef,
      ]);
    } else {
      builderClient.whereRaw(
        `NOT COALESCE(??, '[]')::jsonb @\\? '$[*] \\? (@ =~ "${value}" flag "i")'`,
        [this.tableColumnRef]
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
        `jsonb_extract_path_text(??::jsonb, 'id') IN (${this.createSqlPlaceholders(value)})`,
        [this.tableColumnRef, ...value]
      );
    } else {
      builderClient.whereRaw(`??::jsonb \\?| ARRAY[${this.createSqlPlaceholders(value)}]`, [
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

    if (isUserOrLink(type)) {
      builderClient.whereRaw(
        `COALESCE(jsonb_extract_path_text(COALESCE(??, '{}')::jsonb, 'id'), '') NOT IN (${this.createSqlPlaceholders(
          value
        )})`,
        [this.tableColumnRef, ...value]
      );
    } else {
      builderClient.whereRaw(
        `NOT COALESCE(??, '[]')::jsonb \\?| ARRAY[${this.createSqlPlaceholders(value)}]`,
        [this.tableColumnRef, ...value]
      );
    }
    return builderClient;
  }

  containsOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IFilterValue
  ): Knex.QueryBuilder {
    const { type } = this.field;

    if (type === FieldType.Link) {
      builderClient.whereRaw(`??::jsonb @\\? '$.title \\? (@ like_regex "${value}" flag "i")'`, [
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
    value: IFilterValue
  ): Knex.QueryBuilder {
    const { type } = this.field;

    if (type === FieldType.Link) {
      builderClient.whereRaw(
        `NOT COALESCE(??, '{}')::jsonb @\\? '$.title \\? (@ like_regex "${value}" flag "i")'`,
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
