import type { Knex } from 'knex';
import { SortFunctionSqlite } from '../sort-query.function';

export class MultipleJsonSortAdapter extends SortFunctionSqlite {
  asc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    builderClient.orderByRaw(
      `
      json_extract(${this.columnName}, '$[0]') ASC NULLS FIRST,
      json_array_length${this.columnName} ASC NULLS FIRST
      `
    );
    return builderClient;
  }

  desc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    builderClient.orderByRaw(
      `
      json_extract(${this.columnName}, '$[0]') DESC NULLS LAST,
      json_array_length(${this.columnName}) DESC NULLS LAST
      `
    );
    return builderClient;
  }

  getAscSQL() {
    return this.knex
      .raw(
        `
        json_extract(${this.columnName}, '$[0]') ASC NULLS FIRST,
        json_array_length(${this.columnName}) ASC NULLS FIRST
        `
      )
      .toQuery();
  }

  getDescSQL() {
    return this.knex
      .raw(
        `
        json_extract(${this.columnName}, '$[0]') DESC NULLS LAST,
        json_array_length(${this.columnName}) DESC NULLS LAST
        `
      )
      .toQuery();
  }
}
