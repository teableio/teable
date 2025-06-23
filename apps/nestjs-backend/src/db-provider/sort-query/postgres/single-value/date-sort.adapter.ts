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
      builderClient.orderByRaw('TO_CHAR(TIMEZONE(?, ??), ?) ASC NULLS FIRST', [
        timeZone,
        this.columnName,
        formatString,
      ]);
    } else {
      builderClient.orderBy(this.columnName, 'asc', 'first');
    }

    return builderClient;
  }

  desc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const { options } = this.field;
    const { date, time, timeZone } = (options as IDateFieldOptions).formatting;
    const formatString = getPostgresDateTimeFormatString(date as DateFormattingPreset, time);

    if (time === TimeFormatting.None) {
      builderClient.orderByRaw('TO_CHAR(TIMEZONE(?, ??), ?) DESC NULLS LAST', [
        timeZone,
        this.columnName,
        formatString,
      ]);
    } else {
      builderClient.orderBy(this.columnName, 'desc', 'last');
    }

    return builderClient;
  }

  getAscSQL() {
    const { options } = this.field;
    const { date, time, timeZone } = (options as IDateFieldOptions).formatting;
    const formatString = getPostgresDateTimeFormatString(date as DateFormattingPreset, time);

    if (time === TimeFormatting.None) {
      return this.knex
        .raw('TO_CHAR(TIMEZONE(?, ??), ?) ASC NULLS FIRST', [
          timeZone,
          this.columnName,
          formatString,
        ])
        .toQuery();
    } else {
      return this.knex.raw('?? ASC NULLS FIRST', [this.columnName]).toQuery();
    }
  }

  getDescSQL() {
    const { options } = this.field;
    const { date, time, timeZone } = (options as IDateFieldOptions).formatting;
    const formatString = getPostgresDateTimeFormatString(date as DateFormattingPreset, time);

    if (time === TimeFormatting.None) {
      return this.knex
        .raw('TO_CHAR(TIMEZONE(?, ??), ?) DESC NULLS LAST', [
          timeZone,
          this.columnName,
          formatString,
        ])
        .toQuery();
    } else {
      return this.knex.raw('?? DESC NULLS LAST', [this.columnName]).toQuery();
    }
  }
}
