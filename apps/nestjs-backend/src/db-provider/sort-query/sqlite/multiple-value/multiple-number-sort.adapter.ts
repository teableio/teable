import type { INumberFieldOptions } from '@teable/core';
import type { Knex } from 'knex';
import { SortFunctionSqlite } from '../sort-query.function';

export class MultipleNumberSortAdapter extends SortFunctionSqlite {
  asc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const { options } = this.field;
    const { precision } = (options as INumberFieldOptions).formatting;
    const orderByColumn = this.knex.raw(
      `
      (
        SELECT group_concat(ROUND(elem.value, ?))
        FROM json_each(??) as elem
      ) ASC NULLS FIRST
      `,
      [precision, this.columnName]
    );
    builderClient.orderByRaw(orderByColumn);
    return builderClient;
  }

  desc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const { options } = this.field;
    const { precision } = (options as INumberFieldOptions).formatting;
    const orderByColumn = this.knex.raw(
      `
      (
        SELECT group_concat(ROUND(elem.value, ?))
        FROM json_each(??) as elem
      ) DESC NULLS LAST
      `,
      [precision, this.columnName]
    );
    builderClient.orderByRaw(orderByColumn);
    return builderClient;
  }

  getAscSQL() {
    const { options } = this.field;
    const { precision } = (options as INumberFieldOptions).formatting;
    return this.knex
      .raw(
        `
      (
        SELECT group_concat(ROUND(elem.value, ?))
        FROM json_each(??) as elem
      ) ASC NULLS FIRST
      `,
        [precision, this.columnName]
      )
      .toQuery();
  }

  getDescSQL() {
    const { options } = this.field;
    const { precision } = (options as INumberFieldOptions).formatting;
    return this.knex
      .raw(
        `
      (
        SELECT group_concat(ROUND(elem.value, ?))
        FROM json_each(??) as elem
      ) DESC NULLS LAST
      `,
        [precision, this.columnName]
      )
      .toQuery();
  }
}
