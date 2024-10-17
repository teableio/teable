import type { Knex } from 'knex';
import { isUserOrLink } from '../../../../utils/is-user-or-link';
import { SortFunctionPostgres } from '../sort-query.function';

export class MultipleJsonSortAdapter extends SortFunctionPostgres {
  asc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const { type } = this.field;

    if (isUserOrLink(type)) {
      builderClient.orderByRaw(
        `jsonb_path_query_array(??::jsonb, '$[*].title')::text ASC NULLS FIRST`,
        [this.columnName]
      );
    } else {
      builderClient.orderByRaw(
        `??::jsonb ->> 0 ASC NULLS FIRST, jsonb_array_length(??::jsonb) ASC`,
        [this.columnName, this.columnName]
      );
    }
    return builderClient;
  }

  desc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const { type } = this.field;

    if (isUserOrLink(type)) {
      builderClient.orderByRaw(
        `jsonb_path_query_array(??::jsonb, '$[*].title')::text DESC NULLS LAST`,
        [this.columnName]
      );
    } else {
      builderClient.orderByRaw(
        `??::jsonb ->> 0 DESC NULLS LAST, jsonb_array_length(??::jsonb) DESC`,
        [this.columnName, this.columnName]
      );
    }
    return builderClient;
  }

  getAscSQL() {
    const { type } = this.field;

    if (isUserOrLink(type)) {
      return this.knex
        .raw(`jsonb_path_query_array(??::jsonb, '$[*].title')::text ASC NULLS FIRST`, [
          this.columnName,
        ])
        .toQuery();
    } else {
      return this.knex
        .raw(`??::jsonb ->> 0 ASC NULLS FIRST, jsonb_array_length(??::jsonb) ASC`, [
          this.columnName,
          this.columnName,
        ])
        .toQuery();
    }
  }

  getDescSQL() {
    const { type } = this.field;

    if (isUserOrLink(type)) {
      return this.knex
        .raw(`jsonb_path_query_array(??::jsonb, '$[*].title')::text DESC NULLS LAST`, [
          this.columnName,
        ])
        .toQuery();
    } else {
      return this.knex
        .raw(`??::jsonb ->> 0 DESC NULLS LAST, jsonb_array_length(??::jsonb) DESC`, [
          this.columnName,
          this.columnName,
        ])
        .toQuery();
    }
  }
}
