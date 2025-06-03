import type { Knex } from 'knex';
import { SortFunctionPostgres } from '../sort-query.function';

export class MultipleDateTimeSortAdapter extends SortFunctionPostgres {
  asc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const orderByColumn = this.knex.raw(
      `
      (SELECT to_jsonb(array_agg(elem))
      FROM jsonb_array_elements_text(??::jsonb) as elem) ->> 0
      ASC NULLS FIRST,
      (SELECT to_jsonb(array_agg(elem))
      FROM jsonb_array_elements_text(??::jsonb) as elem)
      ASC NULLS FIRST
      `,
      [this.columnName, this.columnName]
    );
    builderClient.orderByRaw(orderByColumn);
    return builderClient;
  }

  desc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const orderByColumn = this.knex.raw(
      `
      (SELECT to_jsonb(array_agg(elem))
      FROM jsonb_array_elements_text(??::jsonb) as elem) ->> 0
      DESC NULLS LAST,
      (SELECT to_jsonb(array_agg(elem))
      FROM jsonb_array_elements_text(??::jsonb) as elem)
      DESC NULLS LAST
      `,
      [this.columnName, this.columnName]
    );
    builderClient.orderByRaw(orderByColumn);
    return builderClient;
  }

  getAscSQL() {
    return this.knex
      .raw(
        `
      (SELECT to_jsonb(array_agg(elem))
      FROM jsonb_array_elements_text(??::jsonb) as elem) ->> 0
      ASC NULLS FIRST,
      (SELECT to_jsonb(array_agg(elem))
      FROM jsonb_array_elements_text(??::jsonb) as elem)
      ASC NULLS FIRST
      `,
        [this.columnName, this.columnName]
      )
      .toQuery();
  }

  getDescSQL() {
    return this.knex
      .raw(
        `
      (SELECT to_jsonb(array_agg(elem))
      FROM jsonb_array_elements_text(??::jsonb) as elem) ->> 0
      DESC NULLS LAST,
      (SELECT to_jsonb(array_agg(elem))
      FROM jsonb_array_elements_text(??::jsonb) as elem)
      DESC NULLS LAST
      `,
        [this.columnName, this.columnName]
      )
      .toQuery();
  }
}
