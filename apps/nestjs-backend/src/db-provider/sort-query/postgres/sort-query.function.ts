import { DbFieldType } from '@teable/core';
import type { Knex } from 'knex';
import { AbstractSortFunction } from '../function/sort-function.abstract';

export class SortFunctionPostgres extends AbstractSortFunction {
  asc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    if (!this.columnName) {
      return builderClient;
    }

    builderClient.orderByRaw(`${this.getOrderExpression()} ASC NULLS FIRST`);
    return builderClient;
  }

  desc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    if (!this.columnName) {
      return builderClient;
    }

    builderClient.orderByRaw(`${this.getOrderExpression()} DESC NULLS LAST`);
    return builderClient;
  }

  getAscSQL() {
    if (!this.columnName) {
      return undefined;
    }

    return this.knex.raw(`${this.getOrderExpression()} ASC NULLS FIRST`).toQuery();
  }

  getDescSQL() {
    if (!this.columnName) {
      return undefined;
    }

    return this.knex.raw(`${this.getOrderExpression()} DESC NULLS LAST`).toQuery();
  }

  protected applyCollation(expression: string): string {
    return this.collation === 'zh-pinyin' ? `(${expression}) COLLATE "zh-x-icu"` : expression;
  }

  private getOrderExpression(): string {
    const expression =
      this.field.dbFieldType === DbFieldType.Json ? `${this.columnName}::text` : this.columnName!;
    return this.applyCollation(expression);
  }
}
