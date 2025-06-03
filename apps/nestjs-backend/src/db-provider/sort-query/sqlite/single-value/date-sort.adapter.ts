import type { Knex } from 'knex';
import { SortFunctionSqlite } from '../sort-query.function';

export class DateSortAdapter extends SortFunctionSqlite {
  asc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    builderClient.orderBy(this.columnName, 'asc', 'first');
    return builderClient;
  }

  desc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    builderClient.orderBy(this.columnName, 'desc', 'last');

    return builderClient;
  }

  getAscSQL() {
    return this.knex.raw('?? ASC NULLS FIRST', [this.columnName]).toQuery();
  }

  getDescSQL() {
    return this.knex.raw('?? DESC NULLS LAST', [this.columnName]).toQuery();
  }
}
