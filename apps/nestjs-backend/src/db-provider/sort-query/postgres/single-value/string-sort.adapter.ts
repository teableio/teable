import { FieldType } from '@teable-group/core';
import type { Knex } from 'knex';
import type { SingleSelectOptionsDto } from '../../../../features/field/model/field-dto/single-select-field.dto';
import { SortFunctionPostgres } from '../sort-query.function';

export class StringSortAdapter extends SortFunctionPostgres {
  asc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const { type, options } = this.field;

    if (type !== FieldType.SingleSelect) {
      return super.asc(builderClient);
    }

    const { choices } = options as SingleSelectOptionsDto;

    const optionSets = choices.map(({ name }) => name);
    builderClient.orderByRaw(
      `ARRAY_POSITION(ARRAY[${this.createSqlPlaceholders(optionSets)}], ??) ASC NULLS FIRST`,
      [this.columnName]
    );
    return builderClient;
  }

  desc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    const { type, options } = this.field;

    if (type !== FieldType.SingleSelect) {
      return super.desc(builderClient);
    }

    const { choices } = options as SingleSelectOptionsDto;

    const optionSets = choices.map(({ name }) => name);
    builderClient.orderByRaw(
      `ARRAY_POSITION(ARRAY[${this.createSqlPlaceholders(optionSets)}], ??) DESC NULLS LAST`,
      [this.columnName]
    );
    return builderClient;
  }
}
