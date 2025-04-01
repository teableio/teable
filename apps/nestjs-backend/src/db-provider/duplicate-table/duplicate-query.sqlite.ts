import type { Knex } from 'knex';
import { DuplicateTableQueryAbstract } from './abstract';

export class DuplicateTableQuerySqlite extends DuplicateTableQueryAbstract {
  protected knex: Knex.Client;
  constructor(queryBuilder: Knex.QueryBuilder) {
    super(queryBuilder);
    this.knex = queryBuilder.client;
  }

  duplicateTableData(
    sourceTable: string,
    targetTable: string,
    newColumns: string[],
    oldColumns: string[]
  ) {
    const newColumnList = newColumns.map((col) => `"${col}"`).join(', ');
    const oldColumnList = oldColumns
      .map((col) => {
        if (col === '__version') {
          return '1 AS "__version"';
        }
        return `"${col}"`;
      })
      .join(', ');
    return this.knex.raw(
      `INSERT INTO ?? (${newColumnList}) SELECT ${oldColumnList} FROM ?? ORDER BY __auto_number`,
      [targetTable, sourceTable]
    );
  }
}
