import { FieldType } from '@teable-group/core';
import type { Knex } from 'knex';
import { SortFunctionSqlite } from '../sort-query.function';

export class JsonSortAdapter extends SortFunctionSqlite {
  asc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const { type } = this.field;

    if (type === FieldType.Link || type === FieldType.User) {
      builderClient.orderByRaw(`json_extract(??, '$.title') ASC NULLS FIRST`, [this.columnName]);
    } else {
      builderClient.orderByRaw(`?? ASC NULLS FIRST`, [this.columnName]);
    }
    return builderClient;
  }

  desc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const { type } = this.field;

    if (type === FieldType.Link || type === FieldType.User) {
      builderClient.orderByRaw(`json_extract(??, '$.title') DESC NULLS LAST`, [this.columnName]);
    } else {
      builderClient.orderByRaw(`?? DESC NULLS LAST`, [this.columnName]);
    }
    return builderClient;
  }
}
