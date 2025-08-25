import { TimeFormatting, type DateFormattingPreset, type IDateFieldOptions } from '@teable/core';
import type { Knex } from 'knex';
import { getPostgresDateTimeFormatString } from '../../../group-query/format-string';
import { SortFunctionPostgres } from '../sort-query.function';

export class MultipleDateTimeSortAdapter extends SortFunctionPostgres {
  asc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const { options } = this.field;
    const { date, time, timeZone } = (options as IDateFieldOptions).formatting;
    const formatString = getPostgresDateTimeFormatString(date as DateFormattingPreset, time);

    let orderByColumn;
    if (time === TimeFormatting.None) {
      orderByColumn = this.knex.raw(
        `
        (SELECT to_jsonb(array_agg(TO_CHAR(TIMEZONE(?, CAST(elem AS timestamp with time zone)), ?)))
        FROM jsonb_array_elements_text(${this.columnName}::jsonb) as elem) ->> 0
        ASC NULLS FIRST,
        (SELECT to_jsonb(array_agg(TO_CHAR(TIMEZONE(?, CAST(elem AS timestamp with time zone)), ?)))
        FROM jsonb_array_elements_text(${this.columnName}::jsonb) as elem)
        ASC NULLS FIRST
        `,
        [timeZone, formatString, timeZone, formatString]
      );
    } else {
      orderByColumn = this.knex.raw(
        `
        (SELECT to_jsonb(array_agg(elem))
        FROM jsonb_array_elements_text(${this.columnName}::jsonb) as elem) ->> 0
        ASC NULLS FIRST,
        (SELECT to_jsonb(array_agg(elem))
        FROM jsonb_array_elements_text(${this.columnName}::jsonb) as elem)
        ASC NULLS FIRST
        `
      );
    }
    builderClient.orderByRaw(orderByColumn);
    return builderClient;
  }

  desc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const { options } = this.field;
    const { date, time, timeZone } = (options as IDateFieldOptions).formatting;
    const formatString = getPostgresDateTimeFormatString(date as DateFormattingPreset, time);

    let orderByColumn;
    if (time === TimeFormatting.None) {
      orderByColumn = this.knex.raw(
        `
        (SELECT to_jsonb(array_agg(TO_CHAR(TIMEZONE(?, CAST(elem AS timestamp with time zone)), ?)))
        FROM jsonb_array_elements_text(${this.columnName}::jsonb) as elem) ->> 0
        DESC NULLS LAST,
        (SELECT to_jsonb(array_agg(TO_CHAR(TIMEZONE(?, CAST(elem AS timestamp with time zone)), ?)))
        FROM jsonb_array_elements_text(${this.columnName}::jsonb) as elem)
        DESC NULLS LAST
        `,
        [timeZone, formatString, timeZone, formatString]
      );
    } else {
      orderByColumn = this.knex.raw(
        `
        (SELECT to_jsonb(array_agg(elem))
        FROM jsonb_array_elements_text(${this.columnName}::jsonb) as elem) ->> 0
        DESC NULLS LAST,
        (SELECT to_jsonb(array_agg(elem))
        FROM jsonb_array_elements_text(${this.columnName}::jsonb) as elem)
        DESC NULLS LAST
        `
      );
    }
    builderClient.orderByRaw(orderByColumn);
    return builderClient;
  }

  getAscSQL() {
    const { options } = this.field;
    const { date, time, timeZone } = (options as IDateFieldOptions).formatting;
    const formatString = getPostgresDateTimeFormatString(date as DateFormattingPreset, time);

    if (time === TimeFormatting.None) {
      return this.knex
        .raw(
          `
          (SELECT to_jsonb(array_agg(TO_CHAR(TIMEZONE(?, CAST(elem AS timestamp with time zone)), ?)))
          FROM jsonb_array_elements_text(${this.columnName}::jsonb) as elem) ->> 0
          ASC NULLS FIRST,
          (SELECT to_jsonb(array_agg(TO_CHAR(TIMEZONE(?, CAST(elem AS timestamp with time zone)), ?)))
          FROM jsonb_array_elements_text(${this.columnName}::jsonb) as elem)
          ASC NULLS FIRST
          `,
          [timeZone, formatString, timeZone, formatString]
        )
        .toQuery();
    } else {
      return this.knex
        .raw(
          `
          (SELECT to_jsonb(array_agg(elem))
          FROM jsonb_array_elements_text(${this.columnName}::jsonb) as elem) ->> 0
          ASC NULLS FIRST,
          (SELECT to_jsonb(array_agg(elem))
          FROM jsonb_array_elements_text(${this.columnName}::jsonb) as elem)
          ASC NULLS FIRST
          `
        )
        .toQuery();
    }
  }

  getDescSQL() {
    const { options } = this.field;
    const { date, time, timeZone } = (options as IDateFieldOptions).formatting;
    const formatString = getPostgresDateTimeFormatString(date as DateFormattingPreset, time);

    if (time === TimeFormatting.None) {
      return this.knex
        .raw(
          `
          (SELECT to_jsonb(array_agg(TO_CHAR(TIMEZONE(?, CAST(elem AS timestamp with time zone)), ?)))
          FROM jsonb_array_elements_text(${this.columnName}::jsonb) as elem) ->> 0
          DESC NULLS LAST,
          (SELECT to_jsonb(array_agg(TO_CHAR(TIMEZONE(?, CAST(elem AS timestamp with time zone)), ?)))
          FROM jsonb_array_elements_text(${this.columnName}::jsonb) as elem)
          DESC NULLS LAST
          `,
          [timeZone, formatString, timeZone, formatString]
        )
        .toQuery();
    } else {
      return this.knex
        .raw(
          `
          (SELECT to_jsonb(array_agg(elem))
          FROM jsonb_array_elements_text(${this.columnName}::jsonb) as elem) ->> 0
          DESC NULLS LAST,
          (SELECT to_jsonb(array_agg(elem))
          FROM jsonb_array_elements_text(${this.columnName}::jsonb) as elem)
          DESC NULLS LAST
          `
        )
        .toQuery();
    }
  }
}
