import type { Knex } from 'knex';
import { SortFunctionSqlite } from '../sort-query.function';

export class MultipleJsonSortAdapter extends SortFunctionSqlite {
  asc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    builderClient.orderByRaw(`json_extract(??, '$[0]') ASC NULLS FIRST`, [this.columnName]);
    return builderClient;
  }

  desc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    builderClient.orderByRaw(`json_extract(??, '$[0]') DESC NULLS LAST`, [this.columnName]);
    return builderClient;
  }
}
