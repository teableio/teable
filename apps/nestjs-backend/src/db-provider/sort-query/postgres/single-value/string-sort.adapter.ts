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

    const optionSets = choices.map(({ name }) => name);
    builderClient.orderByRaw(
      `ARRAY_POSITION(ARRAY[${this.createSqlPlaceholders(optionSets)}], ??) ASC NULLS FIRST`,
      [...optionSets, this.columnName]
    );
    return builderClient;
  }

  desc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const { type, options } = this.field;

    if (type !== FieldType.SingleSelect) {
      return super.desc(builderClient);
    }

    const { choices } = options as ISelectFieldOptions;

    const optionSets = choices.map(({ name }) => name);
    builderClient.orderByRaw(
      `ARRAY_POSITION(ARRAY[${this.createSqlPlaceholders(optionSets)}], ??) DESC NULLS LAST`,
      [...optionSets, this.columnName]
    );
    return builderClient;
  }
}
