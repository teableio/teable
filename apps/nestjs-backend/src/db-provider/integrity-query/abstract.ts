import type { Knex } from 'knex';

export abstract class IntegrityQueryAbstract {
  constructor(protected readonly knex: Knex) {}

  abstract checkLinks(params: {
    dbTableName: string;
    fkHostTableName: string;
    selfKeyName: string;
    foreignKeyName: string;
    linkDbFieldName: string;
    isMultiValue: boolean;
  }): string;

  abstract fixLinks(params: {
    dbTableName: string;
    fkHostTableName: string;
    selfKeyName: string;
    foreignKeyName: string;
    linkDbFieldName: string;
    isMultiValue: boolean;
  }): string;

  abstract updateJsonField(params: {
    recordIds: string[];
    dbTableName: string;
    field: string;
    value: string | number | boolean | null;
    arrayIndex?: number;
  }): Knex.QueryBuilder;
}
