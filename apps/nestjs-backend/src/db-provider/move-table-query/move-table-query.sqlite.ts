import type { Knex } from 'knex';
import { MoveTableQueryAbstract } from './abstract';

export class MoveTableQuerySqlite extends MoveTableQueryAbstract {
  protected knex: Knex.Client;
  constructor(queryBuilder: Knex.QueryBuilder) {
    super(queryBuilder);
    this.knex = queryBuilder.client;
  }

  getSourceBaseJunctionTableName(sourceBaseId: string): Knex.QueryBuilder {
    return this.queryBuilder
      .select('name as table_name')
      .from('sqlite_master')
      .where('type', 'table')
      .where('name', 'like', `%${sourceBaseId}_junction%`);
  }

  getFullSourceBaseJunctionTableNames(sourceBaseId: string, nameFromSqlQuery: string[]) {
    if (!Array.isArray(nameFromSqlQuery)) {
      return [];
    }
    return nameFromSqlQuery;
  }

  getMovedDbTableName(dbTableName: string, targetSchema: string): string {
    const schemaDelimiterIndex = dbTableName.indexOf('_');
    const tableName = dbTableName.slice(schemaDelimiterIndex + 1);
    return `${targetSchema}_${tableName}`;
  }

  updateTableSchema(dbTableName: string, targetSchema: string): Knex.QueryBuilder {
    const newDbTableName = this.getMovedDbTableName(dbTableName, targetSchema);

    return this.knex.raw('ALTER TABLE ?? RENAME TO ??', [dbTableName, newDbTableName]);
  }
}
