import type { Knex } from 'knex';
import { isUserOrLink } from '../../../../utils/is-user-or-link';
import { SortFunctionPostgres } from '../sort-query.function';

export class JsonSortAdapter extends SortFunctionPostgres {
  asc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const { type } = this.field;

    if (isUserOrLink(type)) {
      builderClient.orderByRaw(`${this.columnName}::jsonb ->> 'title' ASC NULLS FIRST`);
    } else {
      builderClient.orderByRaw(`${this.columnName}::jsonb ASC NULLS FIRST`);
    }
    return builderClient;
  }

  desc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const { type } = this.field;

    if (isUserOrLink(type)) {
      builderClient.orderByRaw(`${this.columnName}::jsonb ->> 'title' DESC NULLS LAST`);
    } else {
      builderClient.orderByRaw(`${this.columnName}::jsonb DESC NULLS LAST`);
    }
    return builderClient;
  }

  getAscSQL() {
    const { type } = this.field;

    if (isUserOrLink(type)) {
      return this.knex.raw(`${this.columnName}::jsonb ->> 'title' ASC NULLS FIRST`).toQuery();
    } else {
      return this.knex.raw(`${this.columnName}::jsonb ASC NULLS FIRST`).toQuery();
    }
  }

  getDescSQL() {
    const { type } = this.field;

    if (isUserOrLink(type)) {
      return this.knex.raw(`${this.columnName}::jsonb ->> 'title' DESC NULLS LAST`).toQuery();
    } else {
      return this.knex.raw(`${this.columnName}::jsonb DESC NULLS LAST`).toQuery();
    }
  }
}
