import { CellValueType } from '@teable/core';
import type { ISearchIndexByQueryRo } from '@teable/openapi';
import { type Knex } from 'knex';
import type { IFieldInstance } from '../../features/field/model/factory';
import { SearchQueryAbstract } from './abstract';
import { FieldFormatter } from './index-builder.postgres';
import { FullTextSearchQueryPostgresBuilder } from './search-fts-query.postgres';
import type { ISearchCellValueType } from './types';

export class SearchQueryPostgres extends SearchQueryAbstract {
  protected knex: Knex.Client;
  constructor(
    protected originQueryBuilder: Knex.QueryBuilder,
    protected field: IFieldInstance,
    protected searchValue: string,
    protected withFullTextIndex?: boolean
  ) {
    super(originQueryBuilder, field, searchValue, withFullTextIndex);
    this.knex = originQueryBuilder.client;
  }

  appendBuilder() {
    const { originQueryBuilder } = this;
    this.originQueryBuilder.orWhereRaw(this.getSql());
    return originQueryBuilder;
  }

  getSql() {
    return this.getQuery().toQuery() as string;
  }

  getQuery() {
    const { field, withFullTextIndex } = this;
    const { isMultipleCellValue } = field;

    if (withFullTextIndex) {
      return this.getFullTextQuery();
    } else {
      return isMultipleCellValue ? this.multipleValue() : this.singleValue();
    }
  }

  protected getFullTextQuery() {
    const dbFieldName = this.field.dbFieldName;
    const { searchValue, knex } = this;
    const tsName = FullTextSearchQueryPostgresBuilder.getTsVectorColumnName(dbFieldName);
    const processedSearchValue = searchValue
      .split(/\s+/)
      .filter(Boolean)
      .filter((term) => term.length > 0)
      .map((term) => `${term}:*`)
      .join(' & ');

    if (!processedSearchValue) {
      return knex.raw('false');
    }

    return knex.raw(`"${tsName}" @@ to_tsquery('simple', ?)`, [processedSearchValue]);
  }

  protected getSingleCellTypeSql() {
    const { field } = this;
    const { isStructuredCellValue, cellValueType } = field;
    switch (cellValueType as ISearchCellValueType) {
      case CellValueType.String: {
        if (isStructuredCellValue) {
          return this.json();
        } else {
          return this.text();
        }
      }
      case CellValueType.DateTime: {
        return this.date();
      }
      case CellValueType.Number: {
        return this.number();
      }
      default:
        return this.text();
    }
  }

  protected getMultipleCellTypeSql() {
    const { field } = this;
    const { isStructuredCellValue, cellValueType } = field;
    switch (cellValueType as ISearchCellValueType) {
      case CellValueType.String: {
        if (isStructuredCellValue) {
          return this.multipleJson();
        } else {
          return this.multipleText();
        }
      }
      case CellValueType.DateTime: {
        return this.multipleDate();
      }
      case CellValueType.Number: {
        return this.multipleNumber();
      }
      default:
        return this.multipleText();
    }
  }

  private singleValue() {
    const { searchValue, knex, field } = this;
    const expression = FieldFormatter.getSearchableExpression(field);
    return knex.raw(`(${expression}) ILIKE ?`, [`%${searchValue}%`]);
  }

  private multipleValue() {
    const { searchValue, knex, field } = this;
    const expression = FieldFormatter.getSearchableExpression(field, true);
    return knex.raw(`(${expression}) ILIKE ?`, [`%${searchValue}%`]);
  }

  protected text() {
    return this.singleValue();
  }

  protected number() {
    return this.singleValue();
  }

  protected date() {
    return this.singleValue();
  }

  protected json() {
    return this.singleValue();
  }

  protected multipleText() {
    return this.multipleValue();
  }

  protected multipleNumber() {
    return this.multipleValue();
  }

  protected multipleDate() {
    return this.multipleValue();
  }

  protected multipleJson() {
    return this.multipleValue();
  }
}

export class SearchQueryPostgresBuilder {
  constructor(
    public queryBuilder: Knex.QueryBuilder,
    public dbTableName: string,
    public searchFields: IFieldInstance[],
    public searchIndexRo: ISearchIndexByQueryRo,
    public baseSortIndex?: string,
    public setFilterQuery?: (qb: Knex.QueryBuilder) => void,
    public setSortQuery?: (qb: Knex.QueryBuilder) => void,
    public withFullTextIndex?: boolean
  ) {
    this.queryBuilder = queryBuilder;
    this.dbTableName = dbTableName;
    this.searchFields = searchFields;
    this.baseSortIndex = baseSortIndex;
    this.searchIndexRo = searchIndexRo;
    this.setFilterQuery = setFilterQuery;
    this.setSortQuery = setSortQuery;
    this.withFullTextIndex = withFullTextIndex || false;
  }

  getSearchQuery() {
    const { queryBuilder, searchIndexRo, searchFields: searchFields, withFullTextIndex } = this;
    const { search } = searchIndexRo;
    const searchValue = search?.[0];

    if (!search || !searchFields?.length || !searchValue) {
      return queryBuilder;
    }

    return searchFields.map((field) => {
      const searchQueryBuilder = new SearchQueryPostgres(
        queryBuilder,
        field,
        searchValue,
        withFullTextIndex
      );
      return searchQueryBuilder.getSql();
    });
  }

  getCaseWhenSqlBy() {
    const { searchFields: searchField, queryBuilder } = this;
    const searchQuerySql = this.getSearchQuery() as string[];
    return searchField.map(({ dbFieldName }, index) => {
      const knexInstance = queryBuilder.client;
      const searchSql = searchQuerySql[index];
      return knexInstance.raw(
        `
          CASE WHEN ${searchSql} THEN ? END
        `,
        [dbFieldName]
      );
    });
  }

  getSearchIndexQuery() {
    const {
      queryBuilder,
      dbTableName,
      searchFields: searchField,
      searchIndexRo,
      setFilterQuery,
      setSortQuery,
      baseSortIndex,
    } = this;

    const { search, groupBy, orderBy, take, skip } = searchIndexRo;
    const knexInstance = queryBuilder.client;

    if (!search || !searchField.length) {
      return queryBuilder;
    }

    const searchQuerySql = this.getSearchQuery() as string[];

    const caseWhenQueryDbSql = this.getCaseWhenSqlBy() as string[];

    queryBuilder.with('filtered_table', (qb) => {
      qb.select('*');

      qb.from(dbTableName);

      qb.where((subQb) => {
        subQb.where((orWhere) => {
          searchQuerySql.forEach((sql) => {
            orWhere.orWhereRaw(sql);
          });
        });
        if (this.searchIndexRo.filter && setFilterQuery) {
          subQb.andWhere((andQb) => {
            setFilterQuery?.(andQb);
          });
        }
      });

      if (orderBy?.length || groupBy?.length) {
        setSortQuery?.(qb);
      }

      take && qb.limit(take);

      qb.offset(skip ?? 0);

      baseSortIndex && qb.orderBy(baseSortIndex, 'asc');
    });

    queryBuilder.with('search_field_union_table', (qb) => {
      qb.select('__id').select(
        knexInstance.raw(
          `array_remove(
            ARRAY [
              ${caseWhenQueryDbSql.join(',')}
            ],
            NULL
          ) as matched_columns`
        )
      );

      qb.from('filtered_table');

      // qb.where((subQb) => {
      //   subQb.where((orWhere) => {
      //     searchQuerySql.forEach((sql) => {
      //       orWhere.orWhereRaw(sql);
      //     });
      //   });
      //   if (this.searchIndexRo.filter && setFilterQuery) {
      //     subQb.andWhere((andQb) => {
      //       setFilterQuery?.(andQb);
      //     });
      //   }
      // });

      // if (orderBy?.length || groupBy?.length) {
      //   setSortQuery?.(qb);
      // }

      // take && qb.limit(take);

      // qb.offset(skip ?? 0);

      // baseSortIndex && qb.orderBy(baseSortIndex, 'asc');
    });

    queryBuilder
      .select('__id', 'matched_column')
      .select(
        knexInstance.raw(
          `CASE
            ${searchField.map((field) => knexInstance.raw(`WHEN matched_column = '${field.dbFieldName}' THEN ?`, [field.id])).join(' ')}
          END AS "fieldId"`
        )
      )
      .fromRaw(
        `
        "search_field_union_table",
        LATERAL unnest(matched_columns) AS matched_column
        `
      )
      .whereRaw(`array_length(matched_columns, 1) > 0`);

    return queryBuilder;
  }
}
