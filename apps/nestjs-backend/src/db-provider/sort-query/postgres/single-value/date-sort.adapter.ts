import { type IDateFieldOptions, type DateFormattingPreset, TimeFormatting } from '@teable/core';
import type { Knex } from 'knex';
import { getPostgresDateTimeFormatString } from '../../../group-query/format-string';
import { SortFunctionPostgres } from '../sort-query.function';

export class DateSortAdapter extends SortFunctionPostgres {
  asc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const { options } = this.field;
    const { date, time, timeZone } = (options as IDateFieldOptions).formatting;
    const formatString = getPostgresDateTimeFormatString(date as DateFormattingPreset, time);

    if (time === TimeFormatting.None) {
      builderClient.orderByRaw(`TO_CHAR(TIMEZONE(?, ${this.columnName}), ?) ASC NULLS FIRST`, [
        timeZone,
        formatString,
      ]);
    } else {
      builderClient.orderByRaw(`${this.columnName} ASC NULLS FIRST`);
    }

    return builderClient;
  }

  desc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const { options } = this.field;
    const { date, time, timeZone } = (options as IDateFieldOptions).formatting;
    const formatString = getPostgresDateTimeFormatString(date as DateFormattingPreset, time);

    if (time === TimeFormatting.None) {
      builderClient.orderByRaw(
        `TO_CHAR(TIMEZONE(?, ${(this, this.columnName)}), ?) DESC NULLS LAST`,
        [timeZone, formatString]
      );
    } else {
      builderClient.orderByRaw(`${this.columnName} DESC NULLS LAST`);
    }

    return builderClient;
  }

  getAscSQL() {
    const { options } = this.field;
    const { date, time, timeZone } = (options as IDateFieldOptions).formatting;
    const formatString = getPostgresDateTimeFormatString(date as DateFormattingPreset, time);

    if (time === TimeFormatting.None) {
      return this.knex
        .raw(`TO_CHAR(TIMEZONE(?, ${this.columnName}), ?) ASC NULLS FIRST`, [
          timeZone,
          formatString,
        ])
        .toQuery();
    } else {
      return this.knex.raw(`${this.columnName} ASC NULLS FIRST`).toQuery();
    }
  }

  getDescSQL() {
    const { options } = this.field;
    const { date, time, timeZone } = (options as IDateFieldOptions).formatting;
    const formatString = getPostgresDateTimeFormatString(date as DateFormattingPreset, time);

    if (time === TimeFormatting.None) {
      return this.knex
        .raw(`TO_CHAR(TIMEZONE(?, ${this.columnName}), ?) DESC NULLS LAST`, [
          timeZone,
          formatString,
        ])
        .toQuery();
    } else {
      return this.knex.raw(`${this.columnName} DESC NULLS LAST`).toQuery();
    }
  }
}
