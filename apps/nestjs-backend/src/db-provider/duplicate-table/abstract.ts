import type { Knex } from 'knex';

export abstract class DuplicateTableQueryAbstract {
  constructor(protected readonly queryBuilder: Knex.QueryBuilder) {}

  abstract duplicateTableData(
    sourceTable: string,
    targetTable: string,
    columns: string[]
  ): Knex.QueryBuilder;
}
