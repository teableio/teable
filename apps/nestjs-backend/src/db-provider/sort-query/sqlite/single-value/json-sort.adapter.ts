import type { Knex } from 'knex';
import { isUserOrLink } from '../../../../utils/is-user-or-link';
import { SortFunctionSqlite } from '../sort-query.function';

export class JsonSortAdapter extends SortFunctionSqlite {
  asc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const { type } = this.field;

    if (isUserOrLink(type)) {
      builderClient.orderByRaw(`json_extract(??, '$.title') ASC NULLS FIRST`, [this.columnName]);
    } else {
      builderClient.orderByRaw(`?? ASC NULLS FIRST`, [this.columnName]);
    }
    return builderClient;
  }

  desc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const { type } = this.field;

    if (isUserOrLink(type)) {
      builderClient.orderByRaw(`json_extract(??, '$.title') DESC NULLS LAST`, [this.columnName]);
    } else {
      builderClient.orderByRaw(`?? DESC NULLS LAST`, [this.columnName]);
    }
    return builderClient;
  }

  getAscSQL() {
    const { type } = this.field;

    if (isUserOrLink(type)) {
      return this.knex
        .raw(`json_extract(??, '$.title') ASC NULLS FIRST`, [this.columnName])
        .toQuery();
    } else {
      return this.knex.raw(`?? ASC NULLS FIRST`, [this.columnName]).toQuery();
    }
  }

  getDescSQL() {
    const { type } = this.field;

    if (isUserOrLink(type)) {
      return this.knex
        .raw(`json_extract(??, '$.title') DESC NULLS LAST`, [this.columnName])
        .toQuery();
    } else {
      return this.knex.raw(`?? DESC NULLS LAST`, [this.columnName]).toQuery();
    }
  }
}
