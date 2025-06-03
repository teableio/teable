import type { IDateFieldOptions } from '@teable/core';
import type { Knex } from 'knex';
import { getPostgresDateTimeFormatString } from '../../format-string';
import { SortFunctionPostgres } from '../sort-query.function';

export class DateSortAdapter extends SortFunctionPostgres {
  asc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const { options } = this.field;
    const { timeZone } = (options as IDateFieldOptions).formatting;
    const formatString = getPostgresDateTimeFormatString();

    builderClient.orderByRaw('TO_CHAR(TIMEZONE(?, ??), ?) ASC NULLS FIRST', [
      timeZone,
      this.columnName,
      formatString,
    ]);
    return builderClient;
  }

  desc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const { options } = this.field;
    const { timeZone } = (options as IDateFieldOptions).formatting;
    const formatString = getPostgresDateTimeFormatString();

    builderClient.orderByRaw('TO_CHAR(TIMEZONE(?, ??), ?) DESC NULLS LAST', [
      timeZone,
      this.columnName,
      formatString,
    ]);
    return builderClient;
  }

  getAscSQL() {
    const { options } = this.field;
    const { timeZone } = (options as IDateFieldOptions).formatting;
    const formatString = getPostgresDateTimeFormatString();

    return this.knex
      .raw('TO_CHAR(TIMEZONE(?, ??), ?) ASC NULLS FIRST', [timeZone, this.columnName, formatString])
      .toQuery();
  }

  getDescSQL() {
    const { options } = this.field;
    const { timeZone } = (options as IDateFieldOptions).formatting;
    const formatString = getPostgresDateTimeFormatString();

    return this.knex
      .raw('TO_CHAR(TIMEZONE(?, ??), ?) DESC NULLS LAST', [timeZone, this.columnName, formatString])
      .toQuery();
  }
}
