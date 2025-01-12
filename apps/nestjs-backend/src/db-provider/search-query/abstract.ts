import type { Knex } from 'knex';
import type { IFieldInstance } from '../../features/field/model/factory';
import type { ISearchQueryConstructor } from './types';

export abstract class SearchQueryAbstract {
  static appendQueryBuilder(
    // eslint-disable-next-line @typescript-eslint/naming-convention
    SearchQuery: ISearchQueryConstructor,
    originQueryBuilder: Knex.QueryBuilder,
    searchFields: IFieldInstance[],
    search?: [string, string?, boolean?],
    withFullTextIndex?: boolean
  ) {
    if (!search || !searchFields?.length) {
      return originQueryBuilder;
    }

    const searchValue = search[0];

    searchFields.forEach((fIns) => {
      const builder = new SearchQuery(originQueryBuilder, fIns, searchValue, withFullTextIndex);
      builder.appendBuilder();
    });

    return originQueryBuilder;
  }

  static buildSearchIndexQuery(
    // eslint-disable-next-line @typescript-eslint/naming-convention
    SearchQuery: ISearchQueryConstructor,
    queryBuilder: Knex.QueryBuilder,
    searchField: IFieldInstance[],
    searchValue: string,
    dbTableName: string,
    withFullTextIndex?: boolean
  ) {
    const knexInstance = queryBuilder.client;
    const searchQuery = searchField.map((field) => {
      const searchQueryBuilder = new SearchQuery(
        queryBuilder,
        field,
        searchValue,
        withFullTextIndex
      );
      return searchQueryBuilder.getSql();
    });

    queryBuilder.with('search_field_union_table', (qb) => {
      for (let index = 0; index < searchQuery.length; index++) {
        const currentWhereRaw = searchQuery[index];
        const dbFieldName = searchField[index].dbFieldName;

        // boolean field or new field which does not support search should be skipped
        if (!currentWhereRaw || !dbFieldName) {
          continue;
        }

        if (index === 0) {
          qb.select('*', knexInstance.raw(`? as matched_column`, [dbFieldName]))
            .whereRaw(`${currentWhereRaw}`)
            .from(dbTableName);
        } else {
          qb.unionAll(function () {
            this.select('*', knexInstance.raw(`? as matched_column`, [dbFieldName]))
              .whereRaw(`${currentWhereRaw}`)
              .from(dbTableName);
          });
        }
      }
    });

    queryBuilder
      .select('__id', '__auto_number', 'matched_column')
      .select(
        knexInstance.raw(
          `CASE
            ${searchField.map((field) => `WHEN matched_column = '${field.dbFieldName}' THEN '${field.id}'`).join(' ')}
          END AS "fieldId"`
        )
      )
      .from('search_field_union_table');
    return queryBuilder;
  }

  static buildSearchCountQuery(
    // eslint-disable-next-line @typescript-eslint/naming-convention
    SearchQuery: ISearchQueryConstructor,
    queryBuilder: Knex.QueryBuilder,
    searchField: IFieldInstance[],
    searchValue: string,
    withFullTextIndex?: boolean
  ) {
    const searchQuery = searchField.map((field) => {
      const searchQueryBuilder = new SearchQuery(
        queryBuilder,
        field,
        searchValue,
        withFullTextIndex
      );
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
    protected readonly searchValue: string,
    protected readonly withFullTextIndex?: boolean
  ) {}

  protected abstract json(): Knex.QueryBuilder;

  protected abstract text(): Knex.QueryBuilder;

  protected abstract date(): Knex.QueryBuilder;

  protected abstract number(): Knex.QueryBuilder;

  protected abstract multipleNumber(): Knex.QueryBuilder;

  protected abstract multipleDate(): Knex.QueryBuilder;

  protected abstract multipleText(): Knex.QueryBuilder;

  protected abstract multipleJson(): Knex.QueryBuilder;

  abstract getSql(): string;

  abstract getQuery(): Knex.QueryBuilder;

  abstract appendBuilder(): Knex.QueryBuilder;
}
