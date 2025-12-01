import type { IDateFieldOptions } from '@teable/core';
import { CellValueType, FieldType } from '@teable/core';
import type { ISearchIndexByQueryRo } from '@teable/openapi';
import { TableIndex } from '@teable/openapi';
import { type Knex } from 'knex';
import { get } from 'lodash';
import type { IFieldInstance } from '../../features/field/model/factory';
import type { IRecordQueryFilterContext } from '../../features/record/query-builder/record-query-builder.interface';
import { escapePostgresRegex } from '../../utils/postgres-regex-escape';
import { SearchQueryAbstract } from './abstract';
import { FieldFormatter } from './search-index-builder.postgres';
import type { ISearchCellValueType } from './types';

export class SearchQueryPostgres extends SearchQueryAbstract {
  protected knex: Knex.Client;
  constructor(
    protected originQueryBuilder: Knex.QueryBuilder,
    protected field: IFieldInstance,
    protected search: [string, string?, boolean?],
    protected tableIndex: TableIndex[],
    protected context?: IRecordQueryFilterContext
  ) {
    super(originQueryBuilder, field, search, tableIndex, context);
    this.knex = originQueryBuilder.client;
  }

  appendBuilder() {
    const { originQueryBuilder } = this;
    const sql = this.getSql();
    if (sql) {
      this.originQueryBuilder.orWhereRaw(sql);
    }
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
      const escapedSearchValue = escapePostgresRegex(searchValue);
      const expression = FieldFormatter.getSearchableExpression(field, isMultipleCellValue);
      return expression ? knex.raw(`(${expression}) ILIKE ?`, [`%${escapedSearchValue}%`]) : null;
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
    const { search, knex } = this;
    const searchValue = search[0];
    const escapedSearchValue = escapePostgresRegex(searchValue);

    if (this.field.type === FieldType.LongText) {
      return knex.raw(
        // chr(13) is carriage return, chr(10) is line feed, chr(9) is tab
        `REPLACE(REPLACE(REPLACE(${this.fieldName}, CHR(13), ' '::text), CHR(10), ' '::text), CHR(9), ' '::text) ILIKE ?`,
        [`%${escapedSearchValue}%`]
      );
    } else {
      return knex.raw(`${this.fieldName} ILIKE ?`, [`%${escapedSearchValue}%`]);
    }
  }

  protected number() {
    const { search, knex } = this;
    const searchValue = search[0];
    const precision = get(this.field, ['options', 'formatting', 'precision']) ?? 0;
    return knex.raw(`ROUND(${this.fieldName}::numeric, ?)::text ILIKE ?`, [
      precision,
      `%${searchValue}%`,
    ]);
  }

  protected date() {
    const {
      search,
      knex,
      field: { options },
    } = this;
    const searchValue = search[0];
    const timeZone = (options as IDateFieldOptions).formatting.timeZone;
    return knex.raw(`TO_CHAR(TIMEZONE(?, ${this.fieldName}), 'YYYY-MM-DD HH24:MI') ILIKE ?`, [
      timeZone,
      `%${searchValue}%`,
    ]);
  }

  protected json() {
    const { search, knex } = this;
    const searchValue = search[0];
    return knex.raw(`(${this.fieldName})::jsonb #>> '{title}' ILIKE ?`, [`%${searchValue}%`]);
  }

  protected multipleText() {
    const { search, knex } = this;
    const searchValue = search[0];
    const escapedSearchValue = escapePostgresRegex(searchValue);
    return knex.raw(
      `
      EXISTS (
        SELECT 1
        FROM (
          SELECT string_agg(elem::text, ', ') as aggregated
          FROM jsonb_array_elements_text(${this.fieldName}::jsonb) as elem
        ) as sub
        WHERE sub.aggregated ~* ?
      )
    `,
      [escapedSearchValue]
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
          FROM jsonb_array_elements_text(${this.fieldName}::jsonb) as elem
        ) as sub
        WHERE sub.aggregated ILIKE ?
      )
      `,
      [precision, `%${searchValue}%`]
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
          FROM jsonb_array_elements_text(${this.fieldName}::jsonb) as elem
        ) as sub
        WHERE sub.aggregated ILIKE ?
      )
      `,
      [timeZone, `%${searchValue}%`]
    );
  }

  protected multipleJson() {
    const { search, knex } = this;
    const searchValue = search[0];
    const escapedSearchValue = escapePostgresRegex(searchValue);
    return knex.raw(
      `
      EXISTS (
        WITH RECURSIVE f(e) AS (
          SELECT ${this.fieldName}::jsonb
          UNION ALL
          SELECT jsonb_array_elements(f.e)
          FROM f
          WHERE jsonb_typeof(f.e) = 'array'
        )
        SELECT 1 FROM (
          SELECT string_agg((e->>'title')::text, ', ') as aggregated
          FROM f
          WHERE jsonb_typeof(e) <> 'array'
        ) as sub
        WHERE sub.aggregated ~* ?
      )
      `,
      [escapedSearchValue]
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
    public context?: IRecordQueryFilterContext,
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
    this.context = context;
  }

  getSearchQuery() {
    const { queryBuilder, searchIndexRo, searchFields, tableIndex, context } = this;
    const { search } = searchIndexRo;

    if (!search || !searchFields?.length) {
      return queryBuilder;
    }

    return searchFields
      .map((field) => {
        const searchQueryBuilder = new SearchQueryPostgres(
          queryBuilder,
          field,
          search,
          tableIndex,
          context
        );
        return searchQueryBuilder.getSql();
      })
      .filter((sql) => sql);
  }

  getCaseWhenSqlBy() {
    const { searchFields, queryBuilder, searchIndexRo, context } = this;
    const { search } = searchIndexRo;
    const isSearchAllFields = !search?.[1];
    const searchQuerySql = this.getSearchQuery() as string[];
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
      .map((field, index) => {
        const knexInstance = queryBuilder.client;
        const searchSql = searchQuerySql[index];

        // Get the correct field name using the same logic as in SearchQueryAbstract
        const selection = context?.selectionMap.get(field.id);
        const fieldName = selection ? (selection as string) : field.dbFieldName;

        return knexInstance.raw(
          `
          CASE WHEN ${searchSql} THEN ? END
        `,
          [fieldName]
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
            ${searchField
              .map((field) => {
                // Get the correct field name using the same logic as in SearchQueryAbstract
                const selection = this.context?.selectionMap.get(field.id);
                const fieldName = selection ? (selection as string) : field.dbFieldName;
                return knexInstance.raw(`WHEN matched_column = '${fieldName}' THEN ?`, [field.id]);
              })
              .join(' ')}
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
