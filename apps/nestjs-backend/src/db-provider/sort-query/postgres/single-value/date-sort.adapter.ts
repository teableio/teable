import type { IDateFieldOptions, DateFormattingPreset } from '@teable/core';
import type { Knex } from 'knex';
import { getPostgresDateTimeFormatString } from '../../../group-query/format-string';
import { SortFunctionPostgres } from '../sort-query.function';

export class DateSortAdapter extends SortFunctionPostgres {
  asc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const { options } = this.field;
    const { date, time, timeZone } = (options as IDateFieldOptions).formatting;
    const formatString = getPostgresDateTimeFormatString(date as DateFormattingPreset, time);

    builderClient.orderByRaw('TO_CHAR(TIMEZONE(?, ??), ?) ASC NULLS FIRST', [
      timeZone,
      this.columnName,
      formatString,
    ]);
    return builderClient;
  }

  desc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const { options } = this.field;
    const { date, time, timeZone } = (options as IDateFieldOptions).formatting;
    const formatString = getPostgresDateTimeFormatString(date as DateFormattingPreset, time);

    builderClient.orderByRaw('TO_CHAR(TIMEZONE(?, ??), ?) DESC NULLS LAST', [
      timeZone,
      this.columnName,
      formatString,
    ]);
    return builderClient;
  }

  getAscSQL() {
    const { options } = this.field;
    const { date, time, timeZone } = (options as IDateFieldOptions).formatting;
    const formatString = getPostgresDateTimeFormatString(date as DateFormattingPreset, time);

    return this.knex
      .raw('TO_CHAR(TIMEZONE(?, ??), ?) ASC NULLS FIRST', [timeZone, this.columnName, formatString])
      .toQuery();
  }

  getDescSQL() {
    const { options } = this.field;
    const { date, time, timeZone } = (options as IDateFieldOptions).formatting;
    const formatString = getPostgresDateTimeFormatString(date as DateFormattingPreset, time);

    return this.knex
      .raw('TO_CHAR(TIMEZONE(?, ??), ?) DESC NULLS LAST', [timeZone, this.columnName, formatString])
      .toQuery();
  }
}
