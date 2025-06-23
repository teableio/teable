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
      builderClient.orderByRaw('strftime(?, DATETIME(??, ?)) ASC NULLS FIRST', [
        formatString,
        this.columnName,
        offsetString,
      ]);
    } else {
      builderClient.orderByRaw('?? ASC NULLS FIRST', [this.columnName]);
    }

    return builderClient;
  }

  desc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const { options } = this.field;
    const { date, time, timeZone } = (options as IDateFieldOptions).formatting;
    const formatString = getSqliteDateTimeFormatString(date as DateFormattingPreset, time);
    const offsetString = `${getOffset(timeZone)} hour`;

    if (time === TimeFormatting.None) {
      builderClient.orderByRaw('strftime(?, DATETIME(??, ?)) DESC NULLS LAST', [
        formatString,
        this.columnName,
        offsetString,
      ]);
    } else {
      builderClient.orderByRaw('?? DESC NULLS LAST', [this.columnName]);
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
        .raw('strftime(?, DATETIME(??, ?)) ASC NULLS FIRST', [
          formatString,
          this.columnName,
          offsetString,
        ])
        .toQuery();
    } else {
      return this.knex.raw('?? ASC NULLS FIRST', [this.columnName]).toQuery();
    }
  }

  getDescSQL() {
    const { options } = this.field;
    const { date, time, timeZone } = (options as IDateFieldOptions).formatting;
    const formatString = getSqliteDateTimeFormatString(date as DateFormattingPreset, time);
    const offsetString = `${getOffset(timeZone)} hour`;

    if (time === TimeFormatting.None) {
      return this.knex
        .raw('strftime(?, DATETIME(??, ?)) DESC NULLS LAST', [
          formatString,
          this.columnName,
          offsetString,
        ])
        .toQuery();
    } else {
      return this.knex.raw('?? DESC NULLS LAST', [this.columnName]).toQuery();
    }
  }
}
