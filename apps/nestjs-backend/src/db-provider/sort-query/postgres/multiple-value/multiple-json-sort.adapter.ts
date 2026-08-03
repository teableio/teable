import type { ISelectFieldOptions } from '@teable/core';
import { FieldType } from '@teable/core';
import type { Knex } from 'knex';
import { isUserOrLink } from '../../../../utils/is-user-or-link';
import { SortFunctionPostgres } from '../sort-query.function';

export class MultipleJsonSortAdapter extends SortFunctionPostgres {
  /**
   * Use the first choice (array[0]) to compute choice index.
   * If not an array, fall back to comparing the raw scalar text.
   */
  private firstChoiceIndexExpr(optionSets: string[]) {
    const arrayLiteral = `ARRAY[${this.createSqlPlaceholders(optionSets)}]`;
    const sql = `CASE
      WHEN ${this.columnName} IS NULL THEN NULL
      WHEN jsonb_typeof(${this.columnName}::jsonb) = 'array'
        THEN ARRAY_POSITION(${arrayLiteral}, jsonb_path_query_first(${this.columnName}::jsonb, '$[0]') #>> '{}')
      ELSE ARRAY_POSITION(${arrayLiteral}, ${this.columnName}::text)
    END`;
    // arrayLiteral is used twice, so duplicate the bindings to satisfy both occurrences
    const bindings = [...optionSets, ...optionSets];
    return { sql, bindings };
  }

  private orderByMultiSelect(
    builderClient: Knex.QueryBuilder,
    direction: 'ASC' | 'DESC',
    nulls: 'FIRST' | 'LAST'
  ) {
    if (!this.columnName) return builderClient;
    const { choices } = this.field.options as ISelectFieldOptions;
    if (!choices.length) return builderClient;
    const optionSets = choices.map(({ name }) => name);
    const { sql, bindings } = this.firstChoiceIndexExpr(optionSets);
    builderClient.orderByRaw(`${sql} ${direction} NULLS ${nulls}`, bindings);
    // Stable tie-breaker to make ordering deterministic when min index is equal
    builderClient.orderByRaw(`${this.columnName}::jsonb::text ${direction} NULLS ${nulls}`);
    return builderClient;
  }

  asc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    if (!this.columnName) {
      return builderClient;
    }
    const { type } = this.field;

    if (isUserOrLink(type)) {
      builderClient.orderByRaw(
        `jsonb_path_query_array(${this.columnName}::jsonb, '$[*].title')::text ASC NULLS FIRST`
      );
    } else if ([FieldType.SingleSelect, FieldType.MultipleSelect].includes(type)) {
      return this.orderByMultiSelect(builderClient, 'ASC', 'FIRST');
    } else {
      builderClient.orderByRaw(
        `${this.columnName}::jsonb ->> 0 ASC NULLS FIRST, jsonb_array_length(${this.columnName}::jsonb) ASC`
      );
    }
    return builderClient;
  }

  desc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    if (!this.columnName) {
      return builderClient;
    }
    const { type } = this.field;

    if (isUserOrLink(type)) {
      builderClient.orderByRaw(
        `jsonb_path_query_array(${this.columnName}::jsonb, '$[*].title')::text DESC NULLS LAST`
      );
    } else if ([FieldType.SingleSelect, FieldType.MultipleSelect].includes(type)) {
      return this.orderByMultiSelect(builderClient, 'DESC', 'LAST');
    } else {
      builderClient.orderByRaw(
        `${this.columnName}::jsonb ->> 0 DESC NULLS LAST, jsonb_array_length(${this.columnName}::jsonb) DESC`
      );
    }
    return builderClient;
  }

  getAscSQL() {
    if (!this.columnName) {
      return undefined;
    }
    const { type } = this.field;

    if (isUserOrLink(type)) {
      return this.knex
        .raw(
          `jsonb_path_query_array(${this.columnName}::jsonb, '$[*].title')::text ASC NULLS FIRST`
        )
        .toQuery();
    } else if ([FieldType.SingleSelect, FieldType.MultipleSelect].includes(type)) {
      const { choices } = this.field.options as ISelectFieldOptions;
      const optionSets = choices.map(({ name }) => name);
      const { sql, bindings } = this.firstChoiceIndexExpr(optionSets);
      return this.knex.raw(`${sql} ASC NULLS FIRST`, bindings).toQuery();
    } else {
      return this.knex
        .raw(
          `${this.columnName}::jsonb ->> 0 ASC NULLS FIRST, jsonb_array_length(${this.columnName}::jsonb) ASC`
        )
        .toQuery();
    }
  }

  getDescSQL() {
    if (!this.columnName) {
      return undefined;
    }
    const { type } = this.field;

    if (isUserOrLink(type)) {
      return this.knex
        .raw(
          `jsonb_path_query_array(${this.columnName}::jsonb, '$[*].title')::text DESC NULLS LAST`
        )
        .toQuery();
    } else if ([FieldType.SingleSelect, FieldType.MultipleSelect].includes(type)) {
      const { choices } = this.field.options as ISelectFieldOptions;
      const optionSets = choices.map(({ name }) => name);
      const { sql, bindings } = this.firstChoiceIndexExpr(optionSets);
      return this.knex.raw(`${sql} DESC NULLS LAST`, bindings).toQuery();
    } else {
      return this.knex
        .raw(
          `${this.columnName}::jsonb ->> 0 DESC NULLS LAST, jsonb_array_length(${this.columnName}::jsonb) DESC`
        )
        .toQuery();
    }
  }
}
