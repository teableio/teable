import type { Knex } from 'knex';
import { SortFunctionSqlite } from '../sort-query.function';

export class MultipleDateTimeSortAdapter extends SortFunctionSqlite {
  asc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const orderByColumn = this.knex.raw(
      `
      (
        SELECT group_concat(elem.value, ', ')
        FROM json_each(??) as elem
      ) ASC NULLS FIRST
      `,
      [this.columnName]
    );
    builderClient.orderByRaw(orderByColumn);
    return builderClient;
  }

  desc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const orderByColumn = this.knex.raw(
      `
      (
        SELECT group_concat(elem.value, ', ')
        FROM json_each(??) as elem
      ) DESC NULLS LAST
      `,
      [this.columnName]
    );
    builderClient.orderByRaw(orderByColumn);
    return builderClient;
  }

  getAscSQL() {
    return this.knex
      .raw(
        `
        (
          SELECT group_concat(elem.value, ', ')
          FROM json_each(??) as elem
        ) ASC NULLS FIRST
        `,
        [this.columnName]
      )
      .toQuery();
  }

  getDescSQL() {
    return this.knex
      .raw(
        `
        (
          SELECT group_concat(elem.value, ', ')
          FROM json_each(??) as elem
        ) DESC NULLS LAST
        `,
        [this.columnName]
      )
      .toQuery();
  }
}
