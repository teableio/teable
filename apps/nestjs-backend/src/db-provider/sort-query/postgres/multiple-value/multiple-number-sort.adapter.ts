import type { INumberFieldOptions } from '@teable/core';
import type { Knex } from 'knex';
import { SortFunctionPostgres } from '../sort-query.function';

export class MultipleNumberSortAdapter extends SortFunctionPostgres {
  asc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const { options } = this.field;
    const { precision } = (options as INumberFieldOptions).formatting;

    const orderByColumn = this.knex.raw(
      `
      (SELECT to_jsonb(array_agg(ROUND(elem::numeric, ?)))
      FROM jsonb_array_elements_text(${this.columnName}::jsonb) as elem) ->> 0
      ASC NULLS FIRST,
      (SELECT to_jsonb(array_agg(ROUND(elem::numeric, ?)))
      FROM jsonb_array_elements_text(${this.columnName}::jsonb) as elem)
      ASC NULLS FIRST
      `,
      [precision, precision]
    );
    builderClient.orderByRaw(orderByColumn);
    return builderClient;
  }

  desc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const { options } = this.field;
    const { precision } = (options as INumberFieldOptions).formatting;

    const orderByColumn = this.knex.raw(
      `
      (SELECT to_jsonb(array_agg(ROUND(elem::numeric, ?)))
      FROM jsonb_array_elements_text(${this.columnName}::jsonb) as elem) ->> 0
      DESC NULLS LAST,
      (SELECT to_jsonb(array_agg(ROUND(elem::numeric, ?)))
      FROM jsonb_array_elements_text(${this.columnName}::jsonb) as elem)
      DESC NULLS LAST
      `,
      [precision, precision]
    );
    builderClient.orderByRaw(orderByColumn);
    return builderClient;
  }

  getAscSQL() {
    const { options } = this.field;
    const { precision } = (options as INumberFieldOptions).formatting;

    return this.knex
      .raw(
        `
        (SELECT to_jsonb(array_agg(ROUND(elem::numeric, ?)))
        FROM jsonb_array_elements_text(${this.columnName}::jsonb) as elem) ->> 0
        ASC NULLS FIRST,
        (SELECT to_jsonb(array_agg(ROUND(elem::numeric, ?)))
        FROM jsonb_array_elements_text(${this.columnName}::jsonb) as elem)
        ASC NULLS FIRST
        `,
        [precision, precision]
      )
      .toQuery();
  }

  getDescSQL() {
    const { options } = this.field;
    const { precision } = (options as INumberFieldOptions).formatting;

    return this.knex
      .raw(
        `
        (SELECT to_jsonb(array_agg(ROUND(elem::numeric, ?)))
        FROM jsonb_array_elements_text(${this.columnName}::jsonb) as elem) ->> 0
        DESC NULLS LAST,
        (SELECT to_jsonb(array_agg(ROUND(elem::numeric, ?)))
        FROM jsonb_array_elements_text(${this.columnName}::jsonb) as elem)
        DESC NULLS LAST
        `,
        [precision, precision]
      )
      .toQuery();
  }
}
