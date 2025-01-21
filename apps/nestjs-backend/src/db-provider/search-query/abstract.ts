import type { TableIndex } from '@teable/openapi';
import type { Knex } from 'knex';
import type { IFieldInstance } from '../../features/field/model/factory';
import type { ISearchQueryConstructor } from './types';

export abstract class SearchQueryAbstract {
  static appendQueryBuilder(
    // eslint-disable-next-line @typescript-eslint/naming-convention
    SearchQuery: ISearchQueryConstructor,
    originQueryBuilder: Knex.QueryBuilder,
    searchFields: IFieldInstance[],
    tableIndex: TableIndex[],
    search: [string, string?, boolean?]
  ) {
    if (!search || !searchFields?.length) {
      return originQueryBuilder;
    }

    searchFields.forEach((fIns) => {
      const builder = new SearchQuery(originQueryBuilder, fIns, search, tableIndex);
      builder.appendBuilder();
    });

    return originQueryBuilder;
  }

  static buildSearchCountQuery(
    // eslint-disable-next-line @typescript-eslint/naming-convention
    SearchQuery: ISearchQueryConstructor,
    queryBuilder: Knex.QueryBuilder,
    searchField: IFieldInstance[],
    search: [string, string?, boolean?],
    tableIndex: TableIndex[]
  ) {
    const searchQuery = searchField.map((field) => {
      const searchQueryBuilder = new SearchQuery(queryBuilder, field, search, tableIndex);
      return searchQueryBuilder.getSql();
    });

    const knexInstance = queryBuilder.client;

    queryBuilder.select(
      knexInstance.raw(`
        COALESCE(SUM(
          ${searchQuery.map((sql) => `(CASE WHEN (${sql}) THEN 1 ELSE 0 END)`).join(' + ')}
        ), 0) as count
      `)
    );

    return queryBuilder;
  }

  constructor(
    protected readonly originQueryBuilder: Knex.QueryBuilder,
    protected readonly field: IFieldInstance,
    protected readonly search: [string, string?, boolean?],
    protected readonly tableIndex: TableIndex[]
  ) {}

  protected abstract json(): Knex.QueryBuilder;

  protected abstract text(): Knex.QueryBuilder;

  protected abstract date(): Knex.QueryBuilder;

  protected abstract number(): Knex.QueryBuilder;

  protected abstract multipleNumber(): Knex.QueryBuilder;

  protected abstract multipleDate(): Knex.QueryBuilder;

  protected abstract multipleText(): Knex.QueryBuilder;

  protected abstract multipleJson(): Knex.QueryBuilder;

  abstract getSql(): string | null;

  abstract getQuery(): Knex.QueryBuilder;

  abstract appendBuilder(): Knex.QueryBuilder;
}
