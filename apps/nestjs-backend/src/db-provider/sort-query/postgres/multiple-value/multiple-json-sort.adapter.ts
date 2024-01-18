import type { Knex } from 'knex';
import { SortFunctionPostgres } from '../sort-query.function';

export class MultipleJsonSortAdapter extends SortFunctionPostgres {
  asc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    builderClient.orderByRaw(`??::jsonb ->> 0 ASC NULLS FIRST`, [this.columnName]);
    return builderClient;
  }

  desc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    builderClient.orderByRaw(`??::jsonb ->> 0 DESC NULLS LAST`, [this.columnName]);
    return builderClient;
  }
}
