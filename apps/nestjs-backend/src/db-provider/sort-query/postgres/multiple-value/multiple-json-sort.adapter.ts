import { FieldType } from '@teable/core';
import type { Knex } from 'knex';
import { SortFunctionPostgres } from '../sort-query.function';

export class MultipleJsonSortAdapter extends SortFunctionPostgres {
  asc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const { type } = this.field;

    if (type === FieldType.Link || type === FieldType.User) {
      builderClient.orderByRaw(
        `jsonb_path_query_array(??::jsonb, '$[*].title')::text ASC NULLS FIRST`,
        [this.columnName]
      );
    } else {
      builderClient.orderByRaw(`??::jsonb ->> 0 ASC NULLS FIRST`, [this.columnName]);
    }
    return builderClient;
  }

  desc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const { type } = this.field;

    if (type === FieldType.Link || type === FieldType.User) {
      builderClient.orderByRaw(
        `jsonb_path_query_array(??::jsonb, '$[*].title')::text DESC NULLS LAST`,
        [this.columnName]
      );
    } else {
      builderClient.orderByRaw(`??::jsonb ->> 0 DESC NULLS LAST`, [this.columnName]);
    }
    return builderClient;
  }
}
