import type { IDateFieldOptions } from '@teable/core';
import type { Knex } from 'knex';
import { getOffset } from '../../../search-query/get-offset';
import { getSqliteDateTimeFormatString } from '../../format-string';
import { SortFunctionSqlite } from '../sort-query.function';

export class DateSortAdapter extends SortFunctionSqlite {
  asc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const { options } = this.field;
    const { timeZone } = (options as IDateFieldOptions).formatting;
    const formatString = getSqliteDateTimeFormatString();
    const offsetString = `${getOffset(timeZone)} hour`;

    builderClient.orderByRaw('strftime(?, DATETIME(??, ?)) ASC NULLS FIRST', [
      formatString,
      this.columnName,
      offsetString,
    ]);
    return builderClient;
  }

  desc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const { options } = this.field;
    const { timeZone } = (options as IDateFieldOptions).formatting;
    const formatString = getSqliteDateTimeFormatString();
    const offsetString = `${getOffset(timeZone)} hour`;

    builderClient.orderByRaw('strftime(?, DATETIME(??, ?)) DESC NULLS LAST', [
      formatString,
      this.columnName,
      offsetString,
    ]);
    return builderClient;
  }

  getAscSQL() {
    const { options } = this.field;
    const { timeZone } = (options as IDateFieldOptions).formatting;
    const formatString = getSqliteDateTimeFormatString();
    const offsetString = `${getOffset(timeZone)} hour`;

    return this.knex
      .raw('strftime(?, DATETIME(??, ?)) ASC NULLS FIRST', [
        formatString,
        this.columnName,
        offsetString,
      ])
      .toQuery();
  }

  getDescSQL() {
    const { options } = this.field;
    const { timeZone } = (options as IDateFieldOptions).formatting;
    const formatString = getSqliteDateTimeFormatString();
    const offsetString = `${getOffset(timeZone)} hour`;

    return this.knex
      .raw('strftime(?, DATETIME(??, ?)) DESC NULLS LAST', [
        formatString,
        this.columnName,
        offsetString,
      ])
      .toQuery();
  }
}
