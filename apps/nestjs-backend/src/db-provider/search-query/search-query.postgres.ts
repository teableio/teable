import type { IDateFieldOptions } from '@teable/core';
import { CellValueType } from '@teable/core';
import type { ISearchIndexByQueryRo } from '@teable/openapi';
import { TableIndex } from '@teable/openapi';
import { type Knex } from 'knex';
import { get } from 'lodash';
import type { IFieldInstance } from '../../features/field/model/factory';
import { SearchQueryAbstract } from './abstract';
import { FieldFormatter } from './search-index-builder.postgres';
import type { ISearchCellValueType } from './types';

export class SearchQueryPostgres extends SearchQueryAbstract {
  protected knex: Knex.Client;
  constructor(
    protected originQueryBuilder: Knex.QueryBuilder,
    protected dbTableName: string,
    protected field: IFieldInstance,
    protected search: [string, string?, boolean?],
    protected tableIndex: TableIndex[]
  ) {
    super(originQueryBuilder, dbTableName, field, search, tableIndex);
    this.knex = originQueryBuilder.client;
  }

  appendBuilder() {
    const { originQueryBuilder } = this;
    const sql = this.getSql();
    sql && this.originQueryBuilder.orWhereRaw(sql);
    return originQueryBuilder;
  }

  getSql(): string | null {
    return this.getQuery() ? this.getQuery().toQuery() : null;
  }

  getQuery() {
    const { field, tableIndex } = this;
    const { isMultipleCellValue } = field;

    if (tableIndex.includes(TableIndex.search)) {
      return this.getSearchQueryWithIndex();
    } else {
      return isMultipleCellValue ? this.getMultipleCellTypeQuery() : this.getSingleCellTypeQuery();
    }
  }

  protected getSearchQueryWithIndex() {
    const { search, knex, field } = this;
    const { isMultipleCellValue } = field;
    const isSearchAllFields = !search[1];
    if (isSearchAllFields) {
      const searchValue = search[0];
      const expression = FieldFormatter.getSearchableExpression(field, isMultipleCellValue);
      return expression ? knex.raw(`(${expression}) ILIKE ?`, [`%${searchValue}%`]) : null;
    } else {
      return isMultipleCellValue ? this.getMultipleCellTypeQuery() : this.getSingleCellTypeQuery();
    }
  }

  protected getSingleCellTypeQuery() {
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

  protected getMultipleCellTypeQuery() {
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
    const { search, knex } = this;
    const searchValue = search[0];
    return knex.raw(`??.?? ILIKE ?`, [this.dbTableName, dbFieldName, `%${searchValue}%`]);
  }

  protected number() {
    const { search, knex } = this;
    const searchValue = search[0];
    const precision = get(this.field, ['options', 'formatting', 'precision']) ?? 0;
    return knex.raw('ROUND(??.??::numeric, ?)::text ILIKE ?', [
      this.dbTableName,
      this.field.dbFieldName,
      precision,
      `%${searchValue}%`,
    ]);
  }

  protected date() {
    const {
      search,
      knex,
      field: { dbFieldName, options },
    } = this;
    const searchValue = search[0];
    const timeZone = (options as IDateFieldOptions).formatting.timeZone;
    return knex.raw("TO_CHAR(TIMEZONE(?, ??.??), 'YYYY-MM-DD HH24:MI') ILIKE ?", [
      timeZone,
      this.dbTableName,
      dbFieldName,
      `%${searchValue}%`,
    ]);
  }

  protected json() {
    const { search, knex } = this;
    const searchValue = search[0];
    return knex.raw("??.??->>'title' ILIKE ?", [
      this.dbTableName,
      this.field.dbFieldName,
      `%${searchValue}%`,
    ]);
  }

  protected multipleText() {
    const { search, knex } = this;
    const searchValue = search[0];
    return knex.raw(
      `
      EXISTS (
        SELECT 1
        FROM (
          SELECT string_agg(elem::text, ', ') as aggregated
          FROM jsonb_array_elements_text(??.??::jsonb) as elem
        ) as sub
        WHERE sub.aggregated ~* ?
      )
    `,
      [this.dbTableName, this.field.dbFieldName, searchValue]
    );
  }

  protected multipleNumber() {
    const { search, knex } = this;
    const searchValue = search[0];
    const precision = get(this.field, ['options', 'formatting', 'precision']) ?? 0;
    return knex.raw(
      `
      EXISTS (
        SELECT 1 FROM (
          SELECT string_agg(ROUND(elem::numeric, ?)::text, ', ') as aggregated
          FROM jsonb_array_elements_text(??.??::jsonb) as elem
        ) as sub
        WHERE sub.aggregated ILIKE ?
      )
      `,
      [precision, this.dbTableName, this.field.dbFieldName, `%${searchValue}%`]
    );
  }

  protected multipleDate() {
    const { search, knex } = this;
    const searchValue = search[0];
    const timeZone = (this.field.options as IDateFieldOptions).formatting.timeZone;
    return knex.raw(
      `
      EXISTS (
        SELECT 1 FROM (
          SELECT string_agg(TO_CHAR(TIMEZONE(?, CAST(elem AS timestamp with time zone)), 'YYYY-MM-DD HH24:MI'), ', ') as aggregated
          FROM jsonb_array_elements_text(??.??::jsonb) as elem
        ) as sub
        WHERE sub.aggregated ILIKE ?
      )
      `,
      [timeZone, this.dbTableName, this.field.dbFieldName, `%${searchValue}%`]
    );
  }

  protected multipleJson() {
    const { search, knex } = this;
    const searchValue = search[0];
    return knex.raw(
      `
      EXISTS (
        SELECT 1 FROM (
          SELECT string_agg(elem->>'title', ', ') as aggregated
          FROM jsonb_array_elements(??.??::jsonb) as elem
        ) as sub
        WHERE sub.aggregated ~* ?
      )
      `,
      [this.dbTableName, this.field.dbFieldName, searchValue]
    );
  }
}

export class SearchQueryPostgresBuilder {
  constructor(
    public queryBuilder: Knex.QueryBuilder,
    public dbTableName: string,
    public searchFields: IFieldInstance[],
    public searchIndexRo: ISearchIndexByQueryRo,
    public tableIndex: TableIndex[],
    public baseSortIndex?: string,
    public setFilterQuery?: (qb: Knex.QueryBuilder) => void,
    public setSortQuery?: (qb: Knex.QueryBuilder) => void
  ) {
    this.queryBuilder = queryBuilder;
    this.dbTableName = dbTableName;
    this.searchFields = searchFields;
    this.baseSortIndex = baseSortIndex;
    this.searchIndexRo = searchIndexRo;
    this.setFilterQuery = setFilterQuery;
    this.setSortQuery = setSortQuery;
    this.tableIndex = tableIndex;
  }

  getSearchQuery(_dbTableName?: string) {
    const { queryBuilder, searchIndexRo, searchFields, tableIndex, dbTableName } = this;
    const { search } = searchIndexRo;

    if (!search || !searchFields?.length) {
      return queryBuilder;
    }

    return searchFields
      .map((field) => {
        const searchQueryBuilder = new SearchQueryPostgres(
          queryBuilder,
          _dbTableName ?? dbTableName,
          field,
          search,
          tableIndex
        );
        return searchQueryBuilder.getSql();
      })
      .filter((sql) => sql);
  }

  getCaseWhenSqlBy(_dbTableName?: string) {
    const { searchFields, queryBuilder, searchIndexRo, dbTableName } = this;
    const { search } = searchIndexRo;
    const isSearchAllFields = !search?.[1];
    const searchQuerySql = this.getSearchQuery(_dbTableName ?? dbTableName) as string[];
    return searchFields
      .filter(({ cellValueType }) => {
        // global search does not support date time and checkbox
        if (
          isSearchAllFields &&
          [CellValueType.DateTime, CellValueType.Boolean].includes(cellValueType)
        ) {
          return false;
        }
        return true;
      })
      .map(({ dbFieldName }, index) => {
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

    const caseWhenQueryDbSql = this.getCaseWhenSqlBy('search_hit_row') as string[];

    queryBuilder.with('search_hit_row', (qb) => {
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

      qb.from('search_hit_row');
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
