import type { Knex } from 'knex';
import { SortFunctionSqlite } from '../sort-query.function';

export class MultipleJsonSortAdapter extends SortFunctionSqlite {
  asc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    builderClient.orderByRaw(
      `
      json_extract(??, '$[0]') ASC NULLS FIRST,
      json_array_length(??) ASC NULLS FIRST
      `,
      [this.columnName, this.columnName]
    );
    return builderClient;
  }

  desc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    builderClient.orderByRaw(
      `
      json_extract(??, '$[0]') DESC NULLS LAST,
      json_array_length(??) DESC NULLS LAST
      `,
      [this.columnName, this.columnName]
    );
    return builderClient;
  }

  getAscSQL() {
    return this.knex
      .raw(
        `
        json_extract(??, '$[0]') ASC NULLS FIRST,
        json_array_length(??) ASC NULLS FIRST
        `,
        [this.columnName, this.columnName]
      )
      .toQuery();
  }

  getDescSQL() {
    return this.knex
      .raw(
        `
        json_extract(??, '$[0]') DESC NULLS LAST,
        json_array_length(??) DESC NULLS LAST
        `,
        [this.columnName, this.columnName]
      )
      .toQuery();
  }
}
