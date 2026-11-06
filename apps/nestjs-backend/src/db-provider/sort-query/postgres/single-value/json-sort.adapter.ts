import type { Knex } from 'knex';
import { isUserOrLink } from '../../../../utils/is-user-or-link';
import { SortFunctionPostgres } from '../sort-query.function';

export class JsonSortAdapter extends SortFunctionPostgres {
  asc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const expression = this.getJsonOrderExpression();
    if (!expression) {
      return builderClient;
    }

    builderClient.orderByRaw(`${expression} ASC NULLS FIRST`);
    return builderClient;
  }

  desc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const expression = this.getJsonOrderExpression();
    if (!expression) {
      return builderClient;
    }

    builderClient.orderByRaw(`${expression} DESC NULLS LAST`);
    return builderClient;
  }

  getAscSQL() {
    const expression = this.getJsonOrderExpression();
    if (!expression) {
      return undefined;
    }

    return this.knex.raw(`${expression} ASC NULLS FIRST`).toQuery();
  }

  getDescSQL() {
    const expression = this.getJsonOrderExpression();
    if (!expression) {
      return undefined;
    }

    return this.knex.raw(`${expression} DESC NULLS LAST`).toQuery();
  }

  private getJsonOrderExpression(): string | undefined {
    if (!this.columnName) {
      return undefined;
    }
    const expression = isUserOrLink(this.field.type)
      ? `${this.columnName}::jsonb ->> 'title'`
      : `${this.columnName}::jsonb`;
    return this.applyCollation(expression);
  }
}
