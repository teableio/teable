import { TimeFormatting, type IDateFieldOptions } from '@teable/core';
import type { Knex } from 'knex';
import { SortFunctionPostgres } from '../sort-query.function';

export class MultipleDateTimeSortAdapter extends SortFunctionPostgres {
  asc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const { options } = this.field;
    const { date, time, timeZone } = (options as IDateFieldOptions).formatting;

    if (time !== TimeFormatting.None) {
      builderClient.orderByRaw(`(??::jsonb ->> 0)::TIMESTAMPTZ ASC NULLS FIRST`, [this.columnName]);
      return builderClient;
    }

    const orderByColumn = this.knex.raw(
      `
      (SELECT to_jsonb(array_agg(TO_CHAR(TIMEZONE(?, CAST(elem AS timestamp with time zone)), '${date}')))
      FROM jsonb_array_elements_text(??::jsonb) as elem)
      ASC NULLS FIRST
      `,
      [timeZone, this.columnName]
    );
    builderClient.orderByRaw(orderByColumn);
    return builderClient;
  }

  desc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const { options } = this.field;
    const { date, time, timeZone } = (options as IDateFieldOptions).formatting;

    if (time !== TimeFormatting.None) {
      builderClient.orderByRaw(`(??::jsonb ->> 0)::TIMESTAMPTZ DESC NULLS LAST`, [this.columnName]);
      return builderClient;
    }

    const orderByColumn = this.knex.raw(
      `
      (SELECT to_jsonb(array_agg(TO_CHAR(TIMEZONE(?, CAST(elem AS timestamp with time zone)), '${date}')))
      FROM jsonb_array_elements_text(??::jsonb) as elem)
      ASC NULLS LAST
      `,
      [timeZone, this.columnName]
    );
    builderClient.orderByRaw(orderByColumn);
    return builderClient;
  }
}
