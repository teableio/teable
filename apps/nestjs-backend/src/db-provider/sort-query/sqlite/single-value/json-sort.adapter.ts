import type { Knex } from 'knex';
import { isUserOrLink } from '../../../../utils/is-user-or-link';
import { SortFunctionSqlite } from '../sort-query.function';

export class JsonSortAdapter extends SortFunctionSqlite {
  asc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const { type } = this.field;

    if (isUserOrLink(type)) {
      builderClient.orderByRaw(`json_extract(${this.columnName}, '$.title') ASC NULLS FIRST`);
    } else {
      builderClient.orderByRaw(`${this.columnName} ASC NULLS FIRST`);
    }
    return builderClient;
  }

  desc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const { type } = this.field;

    if (isUserOrLink(type)) {
      builderClient.orderByRaw(`json_extract(${this.columnName}, '$.title') DESC NULLS LAST`);
    } else {
      builderClient.orderByRaw(`${this.columnName} DESC NULLS LAST`);
    }
    return builderClient;
  }

  getAscSQL() {
    const { type } = this.field;

    if (isUserOrLink(type)) {
      return this.knex.raw(`json_extract(${this.columnName}, '$.title') ASC NULLS FIRST`).toQuery();
    } else {
      return this.knex.raw(`${this.columnName} ASC NULLS FIRST`).toQuery();
    }
  }

  getDescSQL() {
    const { type } = this.field;

    if (isUserOrLink(type)) {
      return this.knex.raw(`json_extract(${this.columnName}, '$.title') DESC NULLS LAST`).toQuery();
    } else {
      return this.knex.raw(`${this.columnName} DESC NULLS LAST`).toQuery();
    }
  }
}
