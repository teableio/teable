import { type IDateFieldOptions, type DateFormattingPreset, TimeFormatting } from '@teable/core';
import type { Knex } from 'knex';
import { getSqliteDateTimeFormatString } from '../../../group-query/format-string';
import { getOffset } from '../../../search-query/get-offset';
import { SortFunctionSqlite } from '../sort-query.function';

export class DateSortAdapter extends SortFunctionSqlite {
  asc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const { options } = this.field;
    const { date, time, timeZone } = (options as IDateFieldOptions).formatting;
    const formatString = getSqliteDateTimeFormatString(date as DateFormattingPreset, time);
    const offsetString = `${getOffset(timeZone)} hour`;

    if (time === TimeFormatting.None) {
      builderClient.orderByRaw('strftime(?, DATETIME(${this.columnName}, ?)) ASC NULLS FIRST', [
        formatString,
        offsetString,
      ]);
    } else {
      builderClient.orderByRaw('${this.columnName} ASC NULLS FIRST');
    }

    return builderClient;
  }

  desc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const { options } = this.field;
    const { date, time, timeZone } = (options as IDateFieldOptions).formatting;
    const formatString = getSqliteDateTimeFormatString(date as DateFormattingPreset, time);
    const offsetString = `${getOffset(timeZone)} hour`;

    if (time === TimeFormatting.None) {
      builderClient.orderByRaw(`strftime(?, DATETIME(${this.columnName}, ?)) DESC NULLS LAST`, [
        formatString,
        offsetString,
      ]);
    } else {
      builderClient.orderByRaw(`${this.columnName} DESC NULLS LAST`);
    }

    return builderClient;
  }

  getAscSQL() {
    const { options } = this.field;
    const { date, time, timeZone } = (options as IDateFieldOptions).formatting;
    const formatString = getSqliteDateTimeFormatString(date as DateFormattingPreset, time);
    const offsetString = `${getOffset(timeZone)} hour`;

    if (time === TimeFormatting.None) {
      return this.knex
        .raw(`strftime(?, DATETIME(${this.columnName}, ?)) ASC NULLS FIRST`, [
          formatString,
          offsetString,
        ])
        .toQuery();
    } else {
      return this.knex.raw(`${this.columnName} ASC NULLS FIRST`).toQuery();
    }
  }

  getDescSQL() {
    const { options } = this.field;
    const { date, time, timeZone } = (options as IDateFieldOptions).formatting;
    const formatString = getSqliteDateTimeFormatString(date as DateFormattingPreset, time);
    const offsetString = `${getOffset(timeZone)} hour`;

    if (time === TimeFormatting.None) {
      return this.knex
        .raw(`strftime(?, DATETIME(${this.columnName}, ?)) DESC NULLS LAST`, [
          formatString,
          offsetString,
        ])
        .toQuery();
    } else {
      return this.knex.raw(`${this.columnName} DESC NULLS LAST`).toQuery();
    }
  }
}
