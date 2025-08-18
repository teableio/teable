import type { Knex } from 'knex';
import { MoveTableQueryAbstract } from './abstract';

export class MoveTableQueryPostgres extends MoveTableQueryAbstract {
  protected knex: Knex.Client;
  constructor(queryBuilder: Knex.QueryBuilder) {
    super(queryBuilder);
    this.knex = queryBuilder.client;
  }

  getSourceBaseJunctionTableName(sourceBaseId: string): Knex.QueryBuilder {
    return this.queryBuilder
      .select('table_name')
      .from('information_schema.tables')
      .where('table_schema', sourceBaseId)
      .where('table_name', 'like', '%junction_%')
      .where('table_type', 'BASE TABLE');
  }

  getFullSourceBaseJunctionTableNames(sourceBaseId: string, nameFromSqlQuery: string[]): string[] {
    if (!Array.isArray(nameFromSqlQuery)) {
      return [];
    }
    return nameFromSqlQuery.map((name) => {
      return `${sourceBaseId}.${name}`;
    });
  }

  getMovedDbTableName(dbTableName: string, targetSchema: string): string {
    const [, tableName] = dbTableName.split('.');
    return `${targetSchema}.${tableName}`;
  }

  updateTableSchema(sourceDbTableName: string, targetSchema: string): Knex.QueryBuilder {
    const [schema, tableName] = sourceDbTableName.split('.');
    return this.knex.raw(
      `
      ALTER TABLE ??.??
      SET SCHEMA ??
    `,
      [schema, tableName, targetSchema]
    );
  }
}
