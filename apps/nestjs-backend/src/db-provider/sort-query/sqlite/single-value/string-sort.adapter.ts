import type { ISelectFieldOptions } from '@teable/core';
import { FieldType } from '@teable/core';
import type { Knex } from 'knex';
import { SortFunctionSqlite } from '../sort-query.function';

export class StringSortAdapter extends SortFunctionSqlite {
  asc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const { type, options } = this.field;

    if (type !== FieldType.SingleSelect) {
      return super.asc(builderClient);
    }

    const { choices } = options as ISelectFieldOptions;

    const optionSets = choices.map(({ name }) => name);
    builderClient.orderByRaw(`${this.generateOrderByCase(optionSets)} ASC NULLS FIRST`, [
      this.columnName,
    ]);
    return builderClient;
  }

  desc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const { type, options } = this.field;

    if (type !== FieldType.SingleSelect) {
      return super.desc(builderClient);
    }

    const { choices } = options as ISelectFieldOptions;

    const optionSets = choices.map(({ name }) => name);
    builderClient.orderByRaw(`${this.generateOrderByCase(optionSets)} DESC NULLS LAST`, [
      this.columnName,
    ]);
    return builderClient;
  }

  getAscSQL() {
    const { type, options } = this.field;

    if (type !== FieldType.SingleSelect) {
      return super.getAscSQL();
    }

    const { choices } = options as ISelectFieldOptions;

    const optionSets = choices.map(({ name }) => name);
    return this.knex
      .raw(`${this.generateOrderByCase(optionSets)} ASC NULLS FIRST`, [this.columnName])
      .toQuery();
  }

  getDescSQL() {
    const { type, options } = this.field;

    if (type !== FieldType.SingleSelect) {
      return super.getDescSQL();
    }

    const { choices } = options as ISelectFieldOptions;

    const optionSets = choices.map(({ name }) => name);
    return this.knex
      .raw(`${this.generateOrderByCase(optionSets)} DESC NULLS LAST`, [this.columnName])
      .toQuery();
  }
}
