import { TimeFormatting, type IDateFieldOptions } from '@teable/core';
import type { Knex } from 'knex';
import { getOffset } from '../../../search-query/get-offset';
import { SortFunctionSqlite } from '../sort-query.function';

export class MultipleDateTimeSortAdapter extends SortFunctionSqlite {
  asc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const { options } = this.field;
    const { time, timeZone } = (options as IDateFieldOptions).formatting;

    if (time !== TimeFormatting.None) {
      builderClient.orderByRaw(`json_extract(??, '$[0]') ASC NULLS FIRST`, [this.columnName]);
      return builderClient;
    }

    const offsetStr = `${getOffset(timeZone)} hour`;
    const orderByColumn = this.knex.raw(
      `
      (
        SELECT group_concat(DATE(elem.value, ?), ', ')
        FROM json_each(??) as elem
      ) ASC NULLS FIRST
      `,
      [offsetStr, this.columnName]
    );
    builderClient.orderByRaw(orderByColumn);
    return builderClient;
  }

  desc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const { options } = this.field;
    const { time, timeZone } = (options as IDateFieldOptions).formatting;

    if (time !== TimeFormatting.None) {
      builderClient.orderByRaw(`json_extract(??, '$[0]') DESC NULLS LAST`, [this.columnName]);
      return builderClient;
    }

    const offsetStr = `${getOffset(timeZone)} hour`;
    const orderByColumn = this.knex.raw(
      `
      (
        SELECT group_concat(DATE(elem.value, ?), ', ')
        FROM json_each(??) as elem
      ) DESC NULLS LAST
      `,
      [offsetStr, this.columnName]
    );
    builderClient.orderByRaw(orderByColumn);
    return builderClient;
  }
}
