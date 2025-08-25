import type { Knex } from 'knex';
import { isUserOrLink } from '../../../../utils/is-user-or-link';
import { SortFunctionPostgres } from '../sort-query.function';

export class MultipleJsonSortAdapter extends SortFunctionPostgres {
  asc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const { type } = this.field;

    if (isUserOrLink(type)) {
      builderClient.orderByRaw(
        `jsonb_path_query_array(${this.columnName}::jsonb, '$[*].title')::text ASC NULLS FIRST`
      );
    } else {
      builderClient.orderByRaw(
        `${this.columnName}::jsonb ->> 0 ASC NULLS FIRST, jsonb_array_length(${this.columnName}::jsonb) ASC`
      );
    }
    return builderClient;
  }

  desc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const { type } = this.field;

    if (isUserOrLink(type)) {
      builderClient.orderByRaw(
        `jsonb_path_query_array(${this.columnName}::jsonb, '$[*].title')::text DESC NULLS LAST`
      );
    } else {
      builderClient.orderByRaw(
        `${this.columnName}::jsonb ->> 0 DESC NULLS LAST, jsonb_array_length(${this.columnName}::jsonb) DESC`
      );
    }
    return builderClient;
  }

  getAscSQL() {
    const { type } = this.field;

    if (isUserOrLink(type)) {
      return this.knex
        .raw(
          `jsonb_path_query_array(${this.columnName}::jsonb, '$[*].title')::text ASC NULLS FIRST`
        )
        .toQuery();
    } else {
      return this.knex
        .raw(
          `${this.columnName}::jsonb ->> 0 ASC NULLS FIRST, jsonb_array_length(${this.columnName}::jsonb) ASC`
        )
        .toQuery();
    }
  }

  getDescSQL() {
    const { type } = this.field;

    if (isUserOrLink(type)) {
      return this.knex
        .raw(
          `jsonb_path_query_array(${this.columnName}::jsonb, '$[*].title')::text DESC NULLS LAST`
        )
        .toQuery();
    } else {
      return this.knex
        .raw(
          `${this.columnName}::jsonb ->> 0 DESC NULLS LAST, jsonb_array_length(${this.columnName}::jsonb) DESC`
        )
        .toQuery();
    }
  }
}
