import type { Knex } from 'knex';
import { DuplicateTableQueryAbstract } from './abstract';

export class DuplicateTableQuerySqlite extends DuplicateTableQueryAbstract {
  protected knex: Knex.Client;
  constructor(queryBuilder: Knex.QueryBuilder) {
    super(queryBuilder);
    this.knex = queryBuilder.client;
  }

  duplicateTableData(sourceTable: string, targetTable: string, columns: string[]) {
    const columnList = columns.map((col) => `"${col}"`).join(', ');
    return this.knex.raw(`INSERT INTO ?? (${columnList}) SELECT ${columnList} FROM ??`, [
      targetTable,
      sourceTable,
    ]);
  }
}
