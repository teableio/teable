import type { DateFormattingPreset, IDateFieldOptions } from '@teable/core';
import type { Knex } from 'knex';
import { getSqliteDateTimeFormatString } from '../../../group-query/format-string';
import { getOffset } from '../../../search-query/get-offset';
import { SortFunctionSqlite } from '../sort-query.function';

export class MultipleDateTimeSortAdapter extends SortFunctionSqlite {
  asc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const { options } = this.field;
    const { date, time, timeZone } = (options as IDateFieldOptions).formatting;
    const formatString = getSqliteDateTimeFormatString(date as DateFormattingPreset, time);
    const offsetString = `${getOffset(timeZone)} hour`;

    const orderByColumn = this.knex.raw(
      `
      (
        SELECT group_concat(strftime(?, DATETIME(elem.value, ?)), ', ')
        FROM json_each(??) as elem
      ) ASC NULLS FIRST
      `,
      [formatString, offsetString, this.columnName]
    );
    builderClient.orderByRaw(orderByColumn);
    return builderClient;
  }

  desc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const { options } = this.field;
    const { date, time, timeZone } = (options as IDateFieldOptions).formatting;
    const formatString = getSqliteDateTimeFormatString(date as DateFormattingPreset, time);
    const offsetString = `${getOffset(timeZone)} hour`;

    const orderByColumn = this.knex.raw(
      `
      (
        SELECT group_concat(strftime(?, DATETIME(elem.value, ?)), ', ')
        FROM json_each(??) as elem
      ) DESC NULLS LAST
      `,
      [formatString, offsetString, this.columnName]
    );
    builderClient.orderByRaw(orderByColumn);
    return builderClient;
  }

  getAscSQL() {
    const { options } = this.field;
    const { date, time, timeZone } = (options as IDateFieldOptions).formatting;
    const formatString = getSqliteDateTimeFormatString(date as DateFormattingPreset, time);
    const offsetString = `${getOffset(timeZone)} hour`;

    return this.knex
      .raw(
        `
        (
          SELECT group_concat(strftime(?, DATETIME(elem.value, ?)), ', ')
          FROM json_each(??) as elem
        ) ASC NULLS FIRST
        `,
        [formatString, offsetString, this.columnName]
      )
      .toQuery();
  }

  getDescSQL() {
    const { options } = this.field;
    const { date, time, timeZone } = (options as IDateFieldOptions).formatting;
    const formatString = getSqliteDateTimeFormatString(date as DateFormattingPreset, time);
    const offsetString = `${getOffset(timeZone)} hour`;

    return this.knex
      .raw(
        `
        (
          SELECT group_concat(strftime(?, DATETIME(elem.value, ?)), ', ')
          FROM json_each(??) as elem
        ) DESC NULLS LAST
        `,
        [formatString, offsetString, this.columnName]
      )
      .toQuery();
  }
}
