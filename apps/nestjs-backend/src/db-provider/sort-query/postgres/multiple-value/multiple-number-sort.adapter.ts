import type { INumberFieldOptions } from '@teable/core';
import type { Knex } from 'knex';
import { SortFunctionPostgres } from '../sort-query.function';

export class MultipleNumberSortAdapter extends SortFunctionPostgres {
  private buildRoundedFirstElementExpr(precision: number) {
    return this.knex.raw(
      `
      ROUND((jsonb_path_query_first(${this.columnName}::jsonb, '$[0]') #>> '{}')::numeric, ?::int)
      `,
      [precision]
    );
  }

  private buildRoundedArrayExpr(precision: number) {
    return this.knex.raw(
      `
      (
        SELECT to_jsonb(array_agg(ROUND(elem::numeric, ?::int)))
        FROM jsonb_array_elements_text(${this.columnName}::jsonb) as elem
      )
      `,
      [precision]
    );
  }

  asc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    if (!this.columnName) {
      return builderClient;
    }
    const { options } = this.field;
    const { precision } = (options as INumberFieldOptions).formatting;
    const firstElementExpr = this.buildRoundedFirstElementExpr(precision).toQuery();
    const arrayExpr = this.buildRoundedArrayExpr(precision).toQuery();
    builderClient.orderByRaw(`${firstElementExpr} ASC NULLS FIRST`);
    builderClient.orderByRaw(`${arrayExpr} ASC NULLS FIRST`);
    return builderClient;
  }

  desc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    if (!this.columnName) {
      return builderClient;
    }
    const { options } = this.field;
    const { precision } = (options as INumberFieldOptions).formatting;
    const firstElementExpr = this.buildRoundedFirstElementExpr(precision).toQuery();
    const arrayExpr = this.buildRoundedArrayExpr(precision).toQuery();
    builderClient.orderByRaw(`${firstElementExpr} DESC NULLS LAST`);
    builderClient.orderByRaw(`${arrayExpr} DESC NULLS LAST`);
    return builderClient;
  }

  getAscSQL() {
    if (!this.columnName) {
      return undefined;
    }
    const { options } = this.field;
    const { precision } = (options as INumberFieldOptions).formatting;
    const firstElementExpr = this.buildRoundedFirstElementExpr(precision).toQuery();
    const arrayExpr = this.buildRoundedArrayExpr(precision).toQuery();
    return `${firstElementExpr} ASC NULLS FIRST, ${arrayExpr} ASC NULLS FIRST`;
  }

  getDescSQL() {
    if (!this.columnName) {
      return undefined;
    }
    const { options } = this.field;
    const { precision } = (options as INumberFieldOptions).formatting;
    const firstElementExpr = this.buildRoundedFirstElementExpr(precision).toQuery();
    const arrayExpr = this.buildRoundedArrayExpr(precision).toQuery();
    return `${firstElementExpr} DESC NULLS LAST, ${arrayExpr} DESC NULLS LAST`;
  }
}
