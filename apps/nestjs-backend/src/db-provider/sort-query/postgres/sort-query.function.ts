import { DbFieldType } from '@teable/core';
import type { Knex } from 'knex';
import { AbstractSortFunction } from '../function/sort-function.abstract';

export class SortFunctionPostgres extends AbstractSortFunction {
  asc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const { dbFieldType } = this.field;

    builderClient.orderByRaw(
      `${dbFieldType === DbFieldType.Json ? '??::text' : '??'} ASC NULLS FIRST`,
      [this.columnName]
    );
    return builderClient;
  }

  desc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const { dbFieldType } = this.field;

    builderClient.orderByRaw(
      `${dbFieldType === DbFieldType.Json ? '??::text' : '??'} DESC NULLS LAST`,
      [this.columnName]
    );
    return builderClient;
  }

  getAscSQL() {
    const { dbFieldType } = this.field;

    return this.knex
      .raw(`${dbFieldType === DbFieldType.Json ? '??::text' : '??'} ASC NULLS FIRST`, [
        this.columnName,
      ])
      .toQuery();
  }

  getDescSQL() {
    const { dbFieldType } = this.field;

    return this.knex
      .raw(`${dbFieldType === DbFieldType.Json ? '??::text' : '??'} DESC NULLS LAST`, [
        this.columnName,
      ])
      .toQuery();
  }
}
