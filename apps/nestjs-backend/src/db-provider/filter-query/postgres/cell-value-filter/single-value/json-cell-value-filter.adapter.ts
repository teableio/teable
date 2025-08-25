import type { IFilterOperator, IFilterValue, ILiteralValue, ILiteralValueList } from '@teable/core';
import { FieldType } from '@teable/core';
import type { Knex } from 'knex';
import { isUserOrLink } from '../../../../../utils/is-user-or-link';
import { escapeJsonbRegex } from '../../../../../utils/postgres-regex-escape';
import { CellValueFilterPostgres } from '../cell-value-filter.postgres';

export class JsonCellValueFilterAdapter extends CellValueFilterPostgres {
  isOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue
  ): Knex.QueryBuilder {
    const { type } = this.field;

    if (isUserOrLink(type)) {
      builderClient.whereRaw(`${this.tableColumnRef}::jsonb @\\? '$.id \\? (@ == "${value}")'`);
    } else {
      builderClient.whereRaw(
        `${this.tableColumnRef}::jsonb @\\? '$[*] \\? (@ =~ "${value}" flag "i")'`
      );
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
      builderClient.whereRaw(
        `NOT COALESCE(${this.tableColumnRef}, '{}')::jsonb @\\? '$.id \\? (@ == "${value}")'`
      );
    } else {
      builderClient.whereRaw(
        `NOT COALESCE(${this.tableColumnRef}, '[]')::jsonb @\\? '$[*] \\? (@ =~ "${value}" flag "i")'`
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
        `jsonb_extract_path_text(${this.tableColumnRef}::jsonb, 'id') IN (${this.createSqlPlaceholders(value)})`,
        value
      );
    } else {
      builderClient.whereRaw(
        `${this.tableColumnRef}::jsonb \\?| ARRAY[${this.createSqlPlaceholders(value)}]`,
        value
      );
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
        `COALESCE(jsonb_extract_path_text(COALESCE(${this.tableColumnRef}, '{}')::jsonb, 'id'), '') NOT IN (${this.createSqlPlaceholders(
          value
        )})`,
        value
      );
    } else {
      builderClient.whereRaw(
        `NOT COALESCE(${this.tableColumnRef}, '[]')::jsonb \\?| ARRAY[${this.createSqlPlaceholders(value)}]`,
        value
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
    const escapedValue = escapeJsonbRegex(String(value));

    if (type === FieldType.Link) {
      builderClient.whereRaw(
        `${this.tableColumnRef}::jsonb @\\? '$.title \\? (@ like_regex "${escapedValue}" flag "i")'`
      );
    } else {
      builderClient.whereRaw(
        `${this.tableColumnRef}::jsonb @\\? '$[*] \\? (@ like_regex "${escapedValue}" flag "i")'`
      );
    }
    return builderClient;
  }

  doesNotContainOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IFilterValue
  ): Knex.QueryBuilder {
    const { type } = this.field;
    const escapedValue = escapeJsonbRegex(String(value));

    if (type === FieldType.Link) {
      builderClient.whereRaw(
        `NOT COALESCE(${this.tableColumnRef}, '{}')::jsonb @\\? '$.title \\? (@ like_regex "${escapedValue}" flag "i")'`
      );
    } else {
      builderClient.whereRaw(
        `NOT COALESCE(${this.tableColumnRef}, '[]')::jsonb @\\? '$[*] \\? (@ like_regex "${escapedValue}" flag "i")'`
      );
    }
    return builderClient;
  }
}
