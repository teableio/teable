import { CellValueType } from '@teable/core';
import type { Knex } from 'knex';
import type { IFieldInstance } from '../../features/field/model/factory';

export abstract class SearchQueryAbstract {
  static factory(
    // eslint-disable-next-line @typescript-eslint/naming-convention
    SearchQuery: new (
      originQueryBuilder: Knex.QueryBuilder,
      field: IFieldInstance,
      searchValue: string
    ) => SearchQueryAbstract,
    originQueryBuilder: Knex.QueryBuilder,
    fieldMap?: { [fieldId: string]: IFieldInstance },
    search?: [string, string?, boolean?]
  ) {
    if (!search || !fieldMap) {
      return originQueryBuilder;
    }

    let searchArr = [];

    if (!search?.[1]) {
      searchArr = Object.values(fieldMap).map((f) => f.id);
    } else {
      searchArr = search[1]?.split(',');
    }

    const searchValue = search[0];

    searchArr.forEach((item) => {
      const field = fieldMap?.[item];

      if (!field) {
        return;
      }

      if (field.cellValueType === CellValueType.Boolean) {
        return;
      }

      const searchQueryBuilder = new SearchQuery(originQueryBuilder, field, searchValue);

      if (field.isMultipleCellValue) {
        switch (field.cellValueType) {
          case CellValueType.DateTime:
            searchQueryBuilder.multipleDate();
            break;
          case CellValueType.Number:
            searchQueryBuilder.multipleNumber();
            break;
          case CellValueType.String:
            if (field.isStructuredCellValue) {
              searchQueryBuilder.multipleJson();
            } else {
              searchQueryBuilder.multipleText();
            }
            break;
        }
        return;
      }

      switch (field.cellValueType) {
        case CellValueType.DateTime:
          searchQueryBuilder.date();
          break;
        case CellValueType.Number:
          searchQueryBuilder.number();
          break;
        case CellValueType.String:
          if (field.isStructuredCellValue) {
            searchQueryBuilder.json();
          } else {
            searchQueryBuilder.text();
          }
          break;
      }
    });

    return originQueryBuilder;
  }

  static buildSearchIndexQuery(
    // eslint-disable-next-line @typescript-eslint/naming-convention
    SearchQuery: new (
      originQueryBuilder: Knex.QueryBuilder,
      field: IFieldInstance,
      searchValue: string
    ) => SearchQueryAbstract,
    queryBuilder: Knex.QueryBuilder,
    searchField: IFieldInstance[],
    searchValue: string,
    dbTableName: string
  ) {
    const knexInstance = queryBuilder.client;
    const searchQuery = searchField.map((field) => {
      const searchQueryBuilder = new SearchQuery(queryBuilder, field, searchValue);
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
    SearchQuery: new (
      originQueryBuilder: Knex.QueryBuilder,
      field: IFieldInstance,
      searchValue: string
    ) => SearchQueryAbstract,
    queryBuilder: Knex.QueryBuilder,
    searchField: IFieldInstance[],
    searchValue: string
  ) {
    const searchQuery = searchField.map((field) => {
      const searchQueryBuilder = new SearchQuery(queryBuilder, field, searchValue);

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
    protected readonly searchValue: string
  ) {}

  abstract multipleNumber(): Knex.QueryBuilder;

  abstract multipleDate(): Knex.QueryBuilder;

  abstract multipleText(): Knex.QueryBuilder;

  abstract multipleJson(): Knex.QueryBuilder;

  abstract json(): Knex.QueryBuilder;

  abstract text(): Knex.QueryBuilder;

  abstract date(): Knex.QueryBuilder;

  abstract number(): Knex.QueryBuilder;

  abstract getNumberSqlQuery(): string;

  abstract getDateSqlQuery(): string;

  abstract getTextSqlQuery(): string;

  abstract getJsonSqlQuery(): string;

  abstract getMultipleNumberSqlQuery(): string;

  abstract getMultipleDateSqlQuery(): string;

  abstract getMultipleTextSqlQuery(): string;

  abstract getMultipleJsonSqlQuery(): string;
}
