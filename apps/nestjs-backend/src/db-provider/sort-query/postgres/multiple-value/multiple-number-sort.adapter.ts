import type { Knex } from 'knex';
import { SortFunctionPostgres } from '../sort-query.function';

export class MultipleNumberSortAdapter extends SortFunctionPostgres {
  asc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    builderClient.orderByRaw(`(??::jsonb ->> 0)::bigint ASC NULLS FIRST`, [this.columnName]);
    return builderClient;
  }

  desc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    builderClient.orderByRaw(`(??::jsonb ->> 0)::bigint DESC NULLS LAST`, [this.columnName]);
    return builderClient;
  }
}
