import type { ISelectFieldOptions } from '@teable/core';
import { FieldType } from '@teable/core';
import type { Knex } from 'knex';
import { SortFunctionPostgres } from '../sort-query.function';

export class StringSortAdapter extends SortFunctionPostgres {
  asc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const { type, options } = this.field;

    if (type !== FieldType.SingleSelect) {
      return super.asc(builderClient);
    }

    const { choices } = options as ISelectFieldOptions;

    if (!choices.length) return builderClient;

    const optionSets = choices.map(({ name }) => name);
    builderClient.orderByRaw(
      `ARRAY_POSITION(ARRAY[${this.createSqlPlaceholders(optionSets)}], ${this.columnName}) ASC NULLS FIRST`,
      [...optionSets]
    );
    return builderClient;
  }

  desc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const { type, options } = this.field;

    if (type !== FieldType.SingleSelect) {
      return super.desc(builderClient);
    }

    const { choices } = options as ISelectFieldOptions;

    if (!choices.length) return builderClient;

    const optionSets = choices.map(({ name }) => name);
    builderClient.orderByRaw(
      `ARRAY_POSITION(ARRAY[${this.createSqlPlaceholders(optionSets)}], ${this.columnName}) DESC NULLS LAST`,
      [...optionSets]
    );
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
      .raw(
        `ARRAY_POSITION(ARRAY[${this.createSqlPlaceholders(optionSets)}], ${this.columnName}) ASC NULLS FIRST`,
        [...optionSets]
      )
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
      .raw(
        `ARRAY_POSITION(ARRAY[${this.createSqlPlaceholders(optionSets)}], ${this.columnName}) DESC NULLS LAST`,

        [...optionSets]
      )
      .toQuery();
  }
}
