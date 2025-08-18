import type { Knex } from 'knex';

export abstract class MoveTableQueryAbstract {
  constructor(protected readonly queryBuilder: Knex.QueryBuilder) {}

  abstract getSourceBaseJunctionTableName(sourceBaseId: string): Knex.QueryBuilder;

  abstract getFullSourceBaseJunctionTableNames(
    sourceBaseId: string,
    nameFromSqlQuery: string[]
  ): string[];

  abstract getMovedDbTableName(dbTableName: string, targetSchema: string): string;

  abstract updateTableSchema(sourceDbTableName: string, targetSchema: string): Knex.QueryBuilder;
}
