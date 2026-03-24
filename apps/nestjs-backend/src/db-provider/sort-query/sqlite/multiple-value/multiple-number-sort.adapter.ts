import type { INumberFieldOptions } from '@teable/core';
import type { Knex } from 'knex';
import { SortFunctionSqlite } from '../sort-query.function';

export class MultipleNumberSortAdapter extends SortFunctionSqlite {
  private buildRoundedFirstElementExpr(precision: number) {
    return this.knex.raw(
      `
      ROUND(CAST(json_extract(${this.columnName}, '$[0]') AS REAL), ?)
      `,
      [precision]
    );
  }

  private buildRoundedArrayExpr(precision: number) {
    return this.knex.raw(
      `
      (
        SELECT json_group_array(ROUND(CAST(elem.value AS REAL), ?))
        FROM json_each(${this.columnName}) as elem
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
