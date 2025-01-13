import { CellValueType, type IDateFieldOptions } from '@teable/core';
import type { ISearchIndexByQueryRo } from '@teable/openapi';
import { type Knex } from 'knex';
import { get } from 'lodash';
import type { IFieldInstance } from '../../features/field/model/factory';
import { SearchQueryAbstract } from './abstract';
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
      return isMultipleCellValue ? this.getMultipleCellTypeSql() : this.getSingleCellTypeSql();
    }
  }

  protected getFullTextQuery() {
    const dbFieldName = this.field.dbFieldName;
    const { searchValue, knex } = this;
    const tsName = FullTextSearchQueryPostgresBuilder.getTsVectorColumnName(dbFieldName);
    return knex.raw(`"${tsName}" @@ plainto_tsquery('simple', '${searchValue}:*')`);
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

  protected text() {
    const dbFieldName = this.field.dbFieldName;
    const { searchValue, knex } = this;
    return knex.raw(`?? ILIKE ?`, [dbFieldName, `%${searchValue}%`]);
  }

  protected number() {
    const { knex } = this;
    const precision = get(this.field, ['options', 'formatting', 'precision']) ?? 0;
    return knex.raw('ROUND(??::numeric, ?)::text ILIKE ?', [
      this.field.dbFieldName,
      precision,
      `%${this.searchValue}%`,
    ]);
  }

  protected date() {
    const { knex } = this;
    const timeZone = (this.field.options as IDateFieldOptions).formatting.timeZone;
    return knex.raw("TO_CHAR(TIMEZONE(?, ??), 'YYYY-MM-DD HH24:MI') ILIKE ?", [
      timeZone,
      this.field.dbFieldName,
      `%${this.searchValue}%`,
    ]);
  }

  protected json() {
    const { knex } = this;
    return knex.raw("??->>'title' ILIKE ?", [this.field.dbFieldName, `%${this.searchValue}%`]);
  }

  protected multipleText() {
    const { knex } = this;
    return knex.raw(
      `
      EXISTS (
        SELECT 1
        FROM (
          SELECT string_agg(elem::text, ', ') as aggregated
          FROM jsonb_array_elements_text(??::jsonb) as elem
        ) as sub
        WHERE sub.aggregated ~* ?
      )
    `,
      [this.field.dbFieldName, this.searchValue]
    );
  }

  protected multipleNumber() {
    const { knex } = this;
    const precision = get(this.field, ['options', 'formatting', 'precision']) ?? 0;
    return knex.raw(
      `
      EXISTS (
        SELECT 1 FROM (
          SELECT string_agg(ROUND(elem::numeric, ?)::text, ', ') as aggregated
          FROM jsonb_array_elements_text(??::jsonb) as elem
        ) as sub
        WHERE sub.aggregated ILIKE ?
      )
      `,
      [precision, this.field.dbFieldName, `%${this.searchValue}%`]
    );
  }

  protected multipleDate() {
    const { knex } = this;
    const timeZone = (this.field.options as IDateFieldOptions).formatting.timeZone;
    return knex.raw(
      `
      EXISTS (
        SELECT 1 FROM (
          SELECT string_agg(TO_CHAR(TIMEZONE(?, CAST(elem AS timestamp with time zone)), 'YYYY-MM-DD HH24:MI'), ', ') as aggregated
          FROM jsonb_array_elements_text(??::jsonb) as elem
        ) as sub
        WHERE sub.aggregated ILIKE ?
      )
      `,
      [timeZone, this.field.dbFieldName, `%${this.searchValue}%`]
    );
  }

  protected multipleJson() {
    const { knex } = this;
    return knex.raw(
      `
      EXISTS (
        SELECT 1 FROM (
          SELECT string_agg(elem->>'title', ', ') as aggregated
          FROM jsonb_array_elements(??::jsonb) as elem
        ) as sub
        WHERE sub.aggregated ~* ?
      )
      `,
      [this.field.dbFieldName, this.searchValue]
    );
  }
}

export class SearchQueryPostgresBuilder {
  constructor(
    public queryBuilder: Knex.QueryBuilder,
    public dbTableName: string,
    public searchField: IFieldInstance[],
    public searchIndexRo: ISearchIndexByQueryRo,
    public baseSortIndex?: string,
    public setFilterQuery?: (qb: Knex.QueryBuilder) => void,
    public setSortQuery?: (qb: Knex.QueryBuilder) => void,
    public withFullTextIndex?: boolean
  ) {
    this.queryBuilder = queryBuilder;
    this.dbTableName = dbTableName;
    this.searchField = searchField;
    this.baseSortIndex = baseSortIndex;
    this.searchIndexRo = searchIndexRo;
    this.setFilterQuery = setFilterQuery;
    this.setSortQuery = setSortQuery;
    this.withFullTextIndex = withFullTextIndex || false;
  }

  getSearchQuery() {
    const { queryBuilder, searchIndexRo, searchField, withFullTextIndex } = this;
    const { search } = searchIndexRo;
    const searchValue = search?.[0];

    if (!search || !searchField?.length || !searchValue) {
      return queryBuilder;
    }

    return searchField.map((field) => {
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
    const { searchField, queryBuilder } = this;
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
      searchField,
      searchIndexRo,
      setFilterQuery,
      setSortQuery,
      baseSortIndex,
    } = this;

    const { search, groupBy, orderBy } = searchIndexRo;
    const knexInstance = queryBuilder.client;

    if (!search || !searchField.length) {
      return queryBuilder;
    }

    const searchQuerySql = this.getSearchQuery() as string[];

    const caseWhenQueryDbSql = this.getCaseWhenSqlBy() as string[];

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

      baseSortIndex && qb.orderBy(baseSortIndex, 'asc');
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
