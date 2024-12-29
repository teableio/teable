import { CellValueType, type IDateFieldOptions } from '@teable/core';
import type { ISearchIndexByQueryRo } from '@teable/openapi';
import type { Knex } from 'knex';
import { get } from 'lodash';
import type { IFieldInstance } from '../../features/field/model/factory';
import { SearchQueryAbstract } from './abstract';
import { getOffset } from './get-offset';

export class SearchQuerySqlite extends SearchQueryAbstract {
  constructor(originQueryBuilder: Knex.QueryBuilder, field: IFieldInstance, searchValue: string) {
    super(originQueryBuilder, field, searchValue);
  }

  multipleNumber() {
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

  multipleDate() {
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

  multipleText() {
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

  multipleJson() {
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

  json() {
    return this.originQueryBuilder.orWhereRaw("json_extract(??, '$.title') LIKE ?", [
      this.field.dbFieldName,
      `%${this.searchValue}%`,
    ]);
  }

  text() {
    return this.originQueryBuilder.orWhere(this.field.dbFieldName, 'LIKE', `%${this.searchValue}%`);
  }

  date() {
    const timeZone = (this.field.options as IDateFieldOptions).formatting.timeZone;
    return this.originQueryBuilder.orWhereRaw('DATETIME(??, ?) LIKE ?', [
      this.field.dbFieldName,
      `${getOffset(timeZone)} hour`,
      `%${this.searchValue}%`,
    ]);
  }

  number() {
    const precision = get(this.field, ['options', 'formatting', 'precision']) ?? 0;
    return this.originQueryBuilder.orWhereRaw('ROUND(??, ?) LIKE ?', [
      this.field.dbFieldName,
      precision,
      `%${this.searchValue}%`,
    ]);
  }

  getNumberSqlQuery() {
    const knexInstance = this.originQueryBuilder.client;
    const precision = get(this.field, ['options', 'formatting', 'precision']) ?? 0;
    return knexInstance
      .raw('ROUND(??, ?) LIKE ?', [this.field.dbFieldName, precision, `%${this.searchValue}%`])
      .toQuery();
  }

  getDateSqlQuery() {
    const knexInstance = this.originQueryBuilder.client;
    const timeZone = (this.field.options as IDateFieldOptions).formatting.timeZone;
    return knexInstance
      .raw('DATETIME(??, ?) LIKE ?', [
        this.field.dbFieldName,
        `${getOffset(timeZone)} hour`,
        `%${this.searchValue}%`,
      ])
      .toQuery();
  }

  getTextSqlQuery() {
    const knexInstance = this.originQueryBuilder.client;
    return knexInstance
      .raw('?? LIKE ?', [this.field.dbFieldName, `%${this.searchValue}%`])
      .toQuery();
  }

  getJsonSqlQuery() {
    const knexInstance = this.originQueryBuilder.client;
    return knexInstance
      .raw("json_extract(??, '$.title') LIKE ?", [this.field.dbFieldName, `%${this.searchValue}%`])
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
            SELECT group_concat(DATETIME(je.value, ?), ', ') as aggregated
            FROM json_each(??) as je
          )
          WHERE aggregated LIKE ?
        )
        `,
        [`${getOffset(timeZone)} hour`, this.field.dbFieldName, `%${this.searchValue}%`]
      )
      .toQuery();
  }

  getMultipleTextSqlQuery() {
    const knexInstance = this.originQueryBuilder.client;
    return knexInstance
      .raw(
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
            SELECT group_concat(ROUND(je.value, ?), ', ') as aggregated
            FROM json_each(??) as je
          )
          WHERE aggregated LIKE ?
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
            SELECT group_concat(json_extract(je.value, '$.title'), ', ') as aggregated
            FROM json_each(??) as je
          )
          WHERE aggregated LIKE ?
        )
        `,
        [this.field.dbFieldName, `%${this.searchValue}%`]
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
      const searchQueryBuilder = new SearchQuerySqlite(queryBuilder, field, searchValue);
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
