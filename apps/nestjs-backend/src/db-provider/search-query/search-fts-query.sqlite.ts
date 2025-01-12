import type { Knex } from 'knex';
import type { IFieldInstance } from '../../features/field/model/factory';

export class FullTextSearchQuerySqliteBuilder {
  constructor(
    public queryBuilder: Knex.QueryBuilder,
    public dbTableName: string,
    public searchFields: IFieldInstance[]
  ) {
    this.queryBuilder = queryBuilder;
    this.dbTableName = dbTableName;
    this.searchFields = searchFields;
  }

  /* eslint-disable-next-line @typescript-eslint/no-unused-vars */
  static getExistFtsIndexSql(queryBuilder: Knex.QueryBuilder, dbTableName: string) {
    return null;
  }

  getSearchFieldIndexSql() {
    return [];
  }

  getClearSearchTsIndexSql() {
    return [];
  }
}
