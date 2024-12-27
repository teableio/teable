import { CellValueType, type IDateFieldOptions } from '@teable/core';
import type { ISearchIndexByQueryRo } from '@teable/openapi';
import { type Knex } from 'knex';
import { get } from 'lodash';
import type { IFieldInstance } from '../../features/field/model/factory';
import { SearchQueryAbstract } from './abstract';

export class SearchQueryPostgres extends SearchQueryAbstract {
  constructor(originQueryBuilder: Knex.QueryBuilder, field: IFieldInstance, searchValue: string) {
    super(originQueryBuilder, field, searchValue);
  }

  multipleNumber() {
    const precision = get(this.field, ['options', 'formatting', 'precision']) ?? 0;
    return this.originQueryBuilder.orWhereRaw(
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

  multipleDate() {
    const timeZone = (this.field.options as IDateFieldOptions).formatting.timeZone;
    return this.originQueryBuilder.orWhereRaw(
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

  multipleText() {
    return this.originQueryBuilder.orWhereRaw(
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

  multipleJson() {
    return this.originQueryBuilder.orWhereRaw(
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

  json() {
    return this.originQueryBuilder.orWhereRaw("??->>'title' ILIKE ?", [
      this.field.dbFieldName,
      `%${this.searchValue}%`,
    ]);
  }

  text() {
    return this.originQueryBuilder.orWhere(
      this.field.dbFieldName,
      'ILIKE',
      `%${this.searchValue}%`
    );
  }

  date() {
    const timeZone = (this.field.options as IDateFieldOptions).formatting.timeZone;
    return this.originQueryBuilder.orWhereRaw(
      "TO_CHAR(TIMEZONE(?, ??), 'YYYY-MM-DD HH24:MI') ILIKE ?",
      [timeZone, this.field.dbFieldName, `%${this.searchValue}%`]
    );
  }

  number() {
    const precision = get(this.field, ['options', 'formatting', 'precision']) ?? 0;
    return this.originQueryBuilder.orWhereRaw('ROUND(??::numeric, ?)::text ILIKE ?', [
      this.field.dbFieldName,
      precision,
      `%${this.searchValue}%`,
    ]);
  }

  getNumberSqlQuery() {
    const precision = get(this.field, ['options', 'formatting', 'precision']) ?? 0;
    const knexInstance = this.originQueryBuilder.client;
    return knexInstance
      .raw('ROUND(??::numeric, ?)::text ILIKE ?', [
        this.field.dbFieldName,
        precision,
        `%${this.searchValue}%`,
      ])
      .toQuery();
  }

  getDateSqlQuery() {
    const knexInstance = this.originQueryBuilder.client;
    const timeZone = (this.field.options as IDateFieldOptions).formatting.timeZone;
    return knexInstance
      .raw("TO_CHAR(TIMEZONE(?, ??), 'YYYY-MM-DD HH24:MI') ILIKE ?", [
        timeZone,
        this.field.dbFieldName,
        `%${this.searchValue}%`,
      ])
      .toQuery();
  }

  getTextSqlQuery() {
    const knexInstance = this.originQueryBuilder.client;
    return knexInstance
      .raw('?? ILIKE ?', [this.field.dbFieldName, `%${this.searchValue}%`])
      .toQuery();
  }

  getJsonSqlQuery() {
    const knexInstance = this.originQueryBuilder.client;
    return knexInstance
      .raw("??->>'title' ILIKE ?", [this.field.dbFieldName, `%${this.searchValue}%`])
      .toQuery();
  }

  getMultipleDateSqlQuery() {
    const knexInstance = this.originQueryBuilder.client;
    const timeZone = (this.field.options as IDateFieldOptions).formatting.timeZone;
    return knexInstance
      .raw(
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
      )
      .toQuery();
  }

  getMultipleTextSqlQuery() {
    const knexInstance = this.originQueryBuilder.client;
    return knexInstance
      .raw(
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
      )
      .toQuery();
  }

  getMultipleNumberSqlQuery() {
    const knexInstance = this.originQueryBuilder.client;
    const precision = get(this.field, ['options', 'formatting', 'precision']) ?? 0;
    return knexInstance
      .raw(
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
      )
      .toQuery();
  }

  getMultipleJsonSqlQuery() {
    const knexInstance = this.originQueryBuilder.client;
    return knexInstance
      .raw(
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
      )
      .toQuery();
  }
}

export class SearchQueryBuilder {
  constructor(
    public queryBuilder: Knex.QueryBuilder,
    public dbTableName: string,
    public searchField: IFieldInstance[],
    public searchIndexRo: ISearchIndexByQueryRo,
    public baseSortIndex?: string,
    public setFilterQuery?: (qb: Knex.QueryBuilder) => void,
    public setSortQuery?: (qb: Knex.QueryBuilder) => void
  ) {
    this.queryBuilder = queryBuilder;
    this.dbTableName = dbTableName;
    this.searchField = searchField;
    this.baseSortIndex = baseSortIndex;
    this.searchIndexRo = searchIndexRo;
    this.setFilterQuery = setFilterQuery;
    this.setSortQuery = setSortQuery;
  }

  getSearchQuery() {
    const { queryBuilder, searchIndexRo, searchField } = this;
    const { search } = searchIndexRo;
    const searchValue = search?.[0];

    if (!search || !searchField?.length || !searchValue) {
      return queryBuilder;
    }

    return searchField.map((field) => {
      const searchQueryBuilder = new SearchQueryPostgres(queryBuilder, field, searchValue);
      if (field.isMultipleCellValue) {
        switch (field.cellValueType) {
          case CellValueType.DateTime:
            return searchQueryBuilder.getMultipleDateSqlQuery();
          case CellValueType.Number:
            return searchQueryBuilder.getMultipleNumberSqlQuery();
          case CellValueType.String:
            if (field.isStructuredCellValue) {
              return searchQueryBuilder.getMultipleJsonSqlQuery();
            } else {
              return searchQueryBuilder.getMultipleTextSqlQuery();
            }
        }
      }

      switch (field.cellValueType) {
        case CellValueType.DateTime:
          return searchQueryBuilder.getDateSqlQuery();
        case CellValueType.Number:
          return searchQueryBuilder.getNumberSqlQuery();
        case CellValueType.String:
          if (field.isStructuredCellValue) {
            return searchQueryBuilder.getJsonSqlQuery();
          } else {
            return searchQueryBuilder.getTextSqlQuery();
          }
      }
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
      qb.select('*').select(
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
      .select('*', 'matched_column')
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
