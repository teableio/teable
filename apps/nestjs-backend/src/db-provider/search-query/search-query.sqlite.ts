import { CellValueType, type IDateFieldOptions } from '@teable/core';
import type { ISearchIndexByQueryRo, TableIndex } from '@teable/openapi';
import type { Knex } from 'knex';
import { get } from 'lodash';
import type { IFieldInstance } from '../../features/field/model/factory';
import { SearchQueryAbstract } from './abstract';
import { getOffset } from './get-offset';
import type { ISearchCellValueType } from './types';

export class SearchQuerySqlite extends SearchQueryAbstract {
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

  getSql(): string {
    return this.getQuery().toQuery();
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
    return knex.raw(`??.?? LIKE ?`, [this.dbTableName, this.field.dbFieldName, `%${searchValue}%`]);
  }

  protected json() {
    const { search, knex } = this;
    const [searchValue] = search;
    return knex.raw("json_extract(??.??, '$.title') LIKE ?", [
      this.dbTableName,
      this.field.dbFieldName,
      `%${searchValue}%`,
    ]);
  }

  protected date() {
    const { search, knex } = this;
    const [searchValue] = search;
    const timeZone = (this.field.options as IDateFieldOptions).formatting.timeZone;
    return knex.raw('DATETIME(??.??, ?) LIKE ?', [
      this.dbTableName,
      this.field.dbFieldName,
      `${getOffset(timeZone)} hour`,
      `%${searchValue}%`,
    ]);
  }

  protected number() {
    const { search, knex } = this;
    const [searchValue] = search;
    const precision = get(this.field, ['options', 'formatting', 'precision']) ?? 0;
    return knex.raw('ROUND(??.??, ?) LIKE ?', [
      this.dbTableName,
      this.field.dbFieldName,
      precision,
      `%${searchValue}%`,
    ]);
  }

  protected multipleText() {
    const { search, knex } = this;
    const [searchValue] = search;
    return knex.raw(
      `
      EXISTS (
        SELECT 1 FROM (
          SELECT group_concat(je.value, ', ') as aggregated
          FROM json_each(??.??) as je
          WHERE je.key != 'title'
        )
        WHERE aggregated LIKE ?
      )
      `,
      [this.dbTableName, this.field.dbFieldName, `%${searchValue}%`]
    );
  }

  protected multipleJson() {
    const { search, knex } = this;
    const [searchValue] = search;
    return knex.raw(
      `
      EXISTS (
        SELECT 1 FROM (
          SELECT group_concat(json_extract(je.value, '$.title'), ', ') as aggregated
          FROM json_each(??.??) as je
        )
        WHERE aggregated LIKE ?
      )
      `,
      [this.dbTableName, this.field.dbFieldName, `%${searchValue}%`]
    );
  }

  protected multipleNumber() {
    const { search, knex } = this;
    const [searchValue] = search;
    const precision = get(this.field, ['options', 'formatting', 'precision']) ?? 0;
    return knex.raw(
      `
      EXISTS (
        SELECT 1 FROM (
          SELECT group_concat(ROUND(je.value, ?), ', ') as aggregated
          FROM json_each(??.??) as je
        )
        WHERE aggregated LIKE ?
      )
      `,
      [precision, this.dbTableName, this.field.dbFieldName, `%${searchValue}%`]
    );
  }

  protected multipleDate() {
    const { search, knex } = this;
    const [searchValue] = search;
    const timeZone = (this.field.options as IDateFieldOptions).formatting.timeZone;
    return knex.raw(
      `
      EXISTS (
        SELECT 1 FROM (
          SELECT group_concat(DATETIME(je.value, ?), ', ') as aggregated
          FROM json_each(??.??) as je
        )
        WHERE aggregated LIKE ?
      )
      `,
      [`${getOffset(timeZone)} hour`, this.dbTableName, this.field.dbFieldName, `%${searchValue}%`]
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

  getSearchQuery(_dbTableName?: string) {
    const { queryBuilder, searchIndexRo, searchField, tableIndex, dbTableName } = this;
    const { search } = searchIndexRo;

    if (!search || !searchField?.length) {
      return queryBuilder;
    }

    return searchField.map((field) => {
      const searchQueryBuilder = new SearchQuerySqlite(
        queryBuilder,
        _dbTableName ?? dbTableName,
        field,
        search,
        tableIndex
      );
      return searchQueryBuilder.getSql();
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

    const searchQuerySql = this.getSearchQuery() as string[];

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

    const searchQuerySql2 = this.getSearchQuery('search_hit_row') as string[];

    queryBuilder.with('search_field_union_table', (qb) => {
      for (let index = 0; index < searchField.length; index++) {
        const currentWhereRaw = searchQuerySql2[index];
        const dbFieldName = searchField[index].dbFieldName;

        // boolean field or new field which does not support search should be skipped
        if (!currentWhereRaw || !dbFieldName) {
          continue;
        }

        if (index === 0) {
          qb.select('*', knexInstance.raw(`? as matched_column`, [dbFieldName]))
            .whereRaw(`${currentWhereRaw}`)
            .from('search_hit_row');
        } else {
          qb.unionAll(function () {
            this.select('*', knexInstance.raw(`? as matched_column`, [dbFieldName]))
              .whereRaw(`${currentWhereRaw}`)
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
            ${searchField.map((field) => `WHEN matched_column = '${field.dbFieldName}' THEN '${field.id}'`).join(' ')}
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
      return knexInstance.raw(`CASE WHEN ?? = ? THEN ? END`, [
        'matched_column',
        field.dbFieldName,
        index + 1,
      ]);
    });
    cases.length && queryBuilder.orderByRaw(cases.join(','));

    return queryBuilder;
  }
}
