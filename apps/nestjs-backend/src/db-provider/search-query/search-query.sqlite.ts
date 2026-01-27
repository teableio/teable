import { CellValueType, type IDateFieldOptions } from '@teable/core';
import type { ISearchIndexByQueryRo, TableIndex } from '@teable/openapi';
import type { Knex } from 'knex';
import { get } from 'lodash';
import type { IFieldInstance } from '../../features/field/model/factory';
import type { IRecordQueryFilterContext } from '../../features/record/query-builder/record-query-builder.interface';
import { escapeLikeWildcards } from '../../utils/sql-like-escape';
import { SearchQueryAbstract } from './abstract';
import { getOffset } from './get-offset';
import type { ISearchCellValueType } from './types';

export class SearchQuerySqlite extends SearchQueryAbstract {
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
    const condition = this.getQuery();
    condition && this.originQueryBuilder.orWhereRaw(condition);
    return originQueryBuilder;
  }

  getSql(): string | null {
    return this.getQuery().toSQL().sql;
  }

  getQuery() {
    const { field } = this;
    const { isMultipleCellValue } = field;

    return isMultipleCellValue ? this.getMultipleCellTypeQuery() : this.getSingleCellTypeQuery();
  }

  protected getSearchQueryWithIndex() {
    return this.originQueryBuilder;
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

  protected text() {
    const { search, knex } = this;
    const [searchValue] = search;
    const escapedSearchValue = escapeLikeWildcards(searchValue);
    return knex.raw(
      `REPLACE(REPLACE(REPLACE(${this.fieldName}, CHAR(13), ' '), CHAR(10), ' '), CHAR(9), ' ') LIKE ? ESCAPE '\\'`,
      [`%${escapedSearchValue}%`]
    );
  }

  protected json() {
    const { search, knex } = this;
    const [searchValue] = search;
    const escapedSearchValue = escapeLikeWildcards(searchValue);
    return knex.raw(`json_extract(${this.fieldName}, '$.title') LIKE ? ESCAPE '\\'`, [
      `%${escapedSearchValue}%`,
    ]);
  }

  protected date() {
    const { search, knex } = this;
    const [searchValue] = search;
    const escapedSearchValue = escapeLikeWildcards(searchValue);
    const timeZone = (this.field.options as IDateFieldOptions).formatting.timeZone;
    return knex.raw(`DATETIME(${this.fieldName}, ?) LIKE ? ESCAPE '\\'`, [
      `${getOffset(timeZone)} hour`,
      `%${escapedSearchValue}%`,
    ]);
  }

  protected number() {
    const { search, knex } = this;
    const [searchValue] = search;
    const escapedSearchValue = escapeLikeWildcards(searchValue);
    const precision = get(this.field, ['options', 'formatting', 'precision']) ?? 0;
    return knex.raw(`ROUND(${this.fieldName}, ?) LIKE ? ESCAPE '\\'`, [
      precision,
      `%${escapedSearchValue}%`,
    ]);
  }

  protected multipleText() {
    const { search, knex } = this;
    const [searchValue] = search;
    const escapedSearchValue = escapeLikeWildcards(searchValue);
    return knex.raw(
      `
      EXISTS (
        SELECT 1 FROM (
          SELECT group_concat(je.value, ', ') as aggregated
          FROM json_each(${this.fieldName}) as je
          WHERE je.key != 'title'
        )
        WHERE aggregated LIKE ? ESCAPE '\\'
      )
      `,
      [`%${escapedSearchValue}%`]
    );
  }

  protected multipleJson() {
    const { search, knex } = this;
    const [searchValue] = search;
    const escapedSearchValue = escapeLikeWildcards(searchValue);
    return knex.raw(
      `
      EXISTS (
        SELECT 1 FROM (
          SELECT group_concat(json_extract(je.value, '$.title'), ', ') as aggregated
          FROM json_each(${this.fieldName}) as je
        )
        WHERE aggregated LIKE ? ESCAPE '\\'
      )
      `,
      [`%${escapedSearchValue}%`]
    );
  }

  protected multipleNumber() {
    const { search, knex } = this;
    const [searchValue] = search;
    const escapedSearchValue = escapeLikeWildcards(searchValue);
    const precision = get(this.field, ['options', 'formatting', 'precision']) ?? 0;
    return knex.raw(
      `
      EXISTS (
        SELECT 1 FROM (
          SELECT group_concat(ROUND(je.value, ?), ', ') as aggregated
          FROM json_each(${this.fieldName}) as je
        )
        WHERE aggregated LIKE ? ESCAPE '\\'
      )
      `,
      [precision, `%${escapedSearchValue}%`]
    );
  }

  protected multipleDate() {
    const { search, knex } = this;
    const [searchValue] = search;
    const escapedSearchValue = escapeLikeWildcards(searchValue);
    const timeZone = (this.field.options as IDateFieldOptions).formatting.timeZone;
    return knex.raw(
      `
      EXISTS (
        SELECT 1 FROM (
          SELECT group_concat(DATETIME(je.value, ?), ', ') as aggregated
          FROM json_each(${this.fieldName}) as je
        )
        WHERE aggregated LIKE ? ESCAPE '\\'
      )
      `,
      [`${getOffset(timeZone)} hour`, `%${escapedSearchValue}%`]
    );
  }
}

export class SearchQuerySqliteBuilder {
  constructor(
    public queryBuilder: Knex.QueryBuilder,
    public dbTableName: string,
    public searchField: IFieldInstance[],
    public searchIndexRo: ISearchIndexByQueryRo,
    public tableIndex: TableIndex[],
    public context?: IRecordQueryFilterContext,
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
    this.context = context;
  }

  private getSearchConditions() {
    const { queryBuilder, searchIndexRo, searchField, tableIndex, context } = this;
    const { search } = searchIndexRo;

    if (!search || !searchField?.length) {
      return [] as Array<{ field: IFieldInstance; condition: Knex.Raw }>;
    }

    return searchField.map((field) => {
      const searchQueryBuilder = new SearchQuerySqlite(
        queryBuilder,
        field,
        search,
        tableIndex,
        context
      );
      return { field, condition: searchQueryBuilder.getQuery() };
    });
  }

  getSearchIndexQuery() {
    const {
      queryBuilder,
      searchIndexRo,
      dbTableName,
      searchField,
      baseSortIndex,
      setFilterQuery,
      setSortQuery,
    } = this;
    const { search, filter, orderBy, groupBy, skip, take } = searchIndexRo;
    const knexInstance = queryBuilder.client;

    if (!search || !searchField?.length) {
      return queryBuilder;
    }

    const searchConditions = this.getSearchConditions();

    queryBuilder.with('search_hit_row', (qb) => {
      qb.select('*');

      qb.from(dbTableName);

      qb.where((subQb) => {
        subQb.where((orWhere) => {
          searchConditions.forEach(({ condition }) => {
            orWhere.orWhereRaw(condition);
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
      for (let index = 0; index < searchConditions.length; index++) {
        const { field, condition } = searchConditions[index];

        // Get the correct field name using the same logic as in SearchQueryAbstract
        const selection = this.context?.selectionMap.get(field.id);
        const fieldName = selection ? (selection as string) : field.dbFieldName;

        // boolean field or new field which does not support search should be skipped
        if (!fieldName) {
          continue;
        }

        if (index === 0) {
          qb.select('*', knexInstance.raw(`? as matched_column`, [fieldName]))
            .whereRaw(condition)
            .from('search_hit_row');
        } else {
          qb.unionAll(function () {
            this.select('*', knexInstance.raw(`? as matched_column`, [fieldName]))
              .whereRaw(condition)
              .from('search_hit_row');
          });
        }
      }
    });

    queryBuilder
      .select('__id', '__auto_number', 'matched_column')
      .select(
        knexInstance.raw(
          `CASE
            ${searchField
              .map((field) => {
                // Get the correct field name using the same logic as in SearchQueryAbstract
                const selection = this.context?.selectionMap.get(field.id);
                const fieldName = selection ? (selection as string) : field.dbFieldName;
                return `WHEN matched_column = '${fieldName}' THEN '${field.id}'`;
              })
              .join(' ')}
          END AS "fieldId"`
        )
      )
      .from('search_field_union_table');

    if (orderBy?.length || groupBy?.length) {
      setSortQuery?.(queryBuilder);
    }

    if (filter) {
      setFilterQuery?.(queryBuilder);
    }

    baseSortIndex && queryBuilder.orderBy(baseSortIndex, 'asc');

    const cases = searchField.map((field, index) => {
      // Get the correct field name using the same logic as in SearchQueryAbstract
      const selection = this.context?.selectionMap.get(field.id);
      const fieldName = selection ? (selection as string) : field.dbFieldName;

      return knexInstance.raw(`CASE WHEN ?? = ? THEN ? END`, [
        'matched_column',
        fieldName,
        index + 1,
      ]);
    });
    cases.length && queryBuilder.orderByRaw(cases.join(','));

    return queryBuilder;
  }
}
