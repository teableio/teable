import type { Knex } from 'knex';
import { SortFunctionPostgres } from '../sort-query.function';

export class DateSortAdapter extends SortFunctionPostgres {
  asc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    builderClient.orderBy(this.columnName, 'desc', 'first');
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
