import { DbFieldType } from '@teable/core';
import type { Knex } from 'knex';
import { AbstractSortFunction } from '../function/sort-function.abstract';

export class SortFunctionPostgres extends AbstractSortFunction {
  asc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const { dbFieldType } = this.field;

    builderClient.orderByRaw(
      `${dbFieldType === DbFieldType.Json ? `${this.columnName}::text` : this.columnName} ASC NULLS FIRST`
    );
    return builderClient;
  }

  desc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const { dbFieldType } = this.field;

    builderClient.orderByRaw(
      `${dbFieldType === DbFieldType.Json ? `${this.columnName}::text` : this.columnName} DESC NULLS LAST`
    );
    return builderClient;
  }

  getAscSQL() {
    const { dbFieldType } = this.field;

    return this.knex
      .raw(
        `${dbFieldType === DbFieldType.Json ? `${this.columnName}::text` : this.columnName} ASC NULLS FIRST`
      )
      .toQuery();
  }

  getDescSQL() {
    const { dbFieldType } = this.field;

    return this.knex
      .raw(
        `${dbFieldType === DbFieldType.Json ? `${this.columnName}::text` : this.columnName} DESC NULLS LAST`
      )
      .toQuery();
  }
}
