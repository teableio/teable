import { CellValueType, type IDateFieldOptions } from '@teable/core';
import type { ISearchIndexByQueryRo } from '@teable/openapi';
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
    const { field } = this;
    const { isMultipleCellValue } = field;

    if (this.withFullTextIndex) {
      return this.getFullTextQuery();
    } else {
      return isMultipleCellValue ? this.getMultipleCellTypeSql() : this.getSingleCellTypeSql();
    }
  }

  protected getFullTextQuery() {
    return this.originQueryBuilder;
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

  protected json() {
    return this.originQueryBuilder.orWhereRaw("json_extract(??, '$.title') LIKE ?", [
      this.field.dbFieldName,
      `%${this.searchValue}%`,
    ]);
  }

  protected text() {
    return this.originQueryBuilder.orWhere(this.field.dbFieldName, 'LIKE', `%${this.searchValue}%`);
  }

  protected date() {
    const timeZone = (this.field.options as IDateFieldOptions).formatting.timeZone;
    return this.originQueryBuilder.orWhereRaw('DATETIME(??, ?) LIKE ?', [
      this.field.dbFieldName,
      `${getOffset(timeZone)} hour`,
      `%${this.searchValue}%`,
    ]);
  }

  protected number() {
    const precision = get(this.field, ['options', 'formatting', 'precision']) ?? 0;
    return this.originQueryBuilder.orWhereRaw('ROUND(??, ?) LIKE ?', [
      this.field.dbFieldName,
      precision,
      `%${this.searchValue}%`,
    ]);
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

  protected multipleNumber() {
    const precision = get(this.field, ['options', 'formatting', 'precision']) ?? 0;
    return this.originQueryBuilder.orWhereRaw(
      `
      EXISTS (
        SELECT 1 FROM (
          SELECT group_concat(ROUND(je.value, ?), ', ') as aggregated
          FROM json_each(??) as je
        )
        WHERE aggregated LIKE ?
      )
      `,
      [precision, this.field.dbFieldName, `%${this.searchValue}%`]
    );
  }

  protected multipleDate() {
    const timeZone = (this.field.options as IDateFieldOptions).formatting.timeZone;
    return this.originQueryBuilder.orWhereRaw(
      `
      EXISTS (
        SELECT 1 FROM (
          SELECT group_concat(DATETIME(je.value, ?), ', ') as aggregated
          FROM json_each(??) as je
        )
        WHERE aggregated LIKE ?
      )
      `,
      [`${getOffset(timeZone)} hour`, this.field.dbFieldName, `%${this.searchValue}%`]
    );
  }

  protected multipleText() {
    return this.originQueryBuilder.orWhereRaw(
      `
      EXISTS (
        SELECT 1 FROM (
          SELECT group_concat(je.value, ', ') as aggregated
          FROM json_each(??) as je
          WHERE je.key != 'title'
        )
        WHERE aggregated LIKE ?
      )
      `,
      [this.field.dbFieldName, `%${this.searchValue}%`]
    );
  }

  protected multipleJson() {
    return this.originQueryBuilder.orWhereRaw(
      `
      EXISTS (
        SELECT 1 FROM (
          SELECT group_concat(json_extract(je.value, '$.title'), ', ') as aggregated
          FROM json_each(??) as je
        )
        WHERE aggregated LIKE ?
      )
      `,
      [this.field.dbFieldName, `%${this.searchValue}%`]
    );
  }
}

export class SearchQuerySqliteBuilder {
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
      const searchQueryBuilder = new SearchQuerySqlite(queryBuilder, field, searchValue);
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
    const { search, filter, orderBy, groupBy } = searchIndexRo;
    const knexInstance = queryBuilder.client;

    if (!search || !searchField?.length) {
      return queryBuilder;
    }

    const searchQuerySql = this.getSearchQuery() as string[];

    queryBuilder.with('search_field_union_table', (qb) => {
      for (let index = 0; index < searchField.length; index++) {
        const currentWhereRaw = searchQuerySql[index];
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
