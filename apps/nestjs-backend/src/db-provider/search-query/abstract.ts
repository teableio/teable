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

  static getSearchCountSql(
    // eslint-disable-next-line @typescript-eslint/naming-convention
    SearchQuery: new (
      originQueryBuilder: Knex.QueryBuilder,
      field: IFieldInstance,
      searchValue: string
    ) => SearchQueryAbstract,
    originQueryBuilder: Knex.QueryBuilder,
    fieldMap?: { [fieldId: string]: IFieldInstance },
    search?: [string, string?, boolean?],
    dbTableName?: string
  ) {
    if (!search || !fieldMap || !dbTableName) {
      return originQueryBuilder;
    }

    let searchArr = [];

    if (!search?.[1]) {
      searchArr = Object.values(fieldMap).map((f) => f.id);
    } else {
      searchArr = search[1]?.split(',');
    }

    const searchValue = search[0];

    const knexInstance = originQueryBuilder.client;

    const joinWhereSql = (index: number, whereSql: string, dbFieldName: string) => {
      if (index === 0) {
        originQueryBuilder
          .select('*', knexInstance.raw('? AS "dbFieldName"', [dbFieldName]))
          .from(knexInstance.raw('??', [dbTableName]))
          .whereRaw(whereSql);
      } else {
        originQueryBuilder.unionAll(function () {
          this.select('*', knexInstance.raw('? AS "dbFieldName"', [dbFieldName]))
            .from(knexInstance.raw('??', [dbTableName]))
            .whereRaw(whereSql);
        });
      }
    };

    searchArr.forEach((item, index) => {
      const field = fieldMap?.[item];

      if (!field) {
        return;
      }

      if (field.cellValueType === CellValueType.Boolean) {
        return;
      }

      const searchQueryBuilder = new SearchQuery(originQueryBuilder, field, searchValue);

      let currentWhereRaw: string;

      if (field.isMultipleCellValue) {
        switch (field.cellValueType) {
          case CellValueType.DateTime:
            currentWhereRaw = searchQueryBuilder.getMultipleDateSqlQuery();
            break;
          case CellValueType.Number:
            currentWhereRaw = searchQueryBuilder.getMultipleNumberSqlQuery();
            break;
          case CellValueType.String:
            if (field.isStructuredCellValue) {
              currentWhereRaw = searchQueryBuilder.getMultipleJsonSqlQuery();
            } else {
              currentWhereRaw = searchQueryBuilder.getMultipleTextSqlQuery();
            }
            break;
        }
        joinWhereSql(index, currentWhereRaw, field.dbFieldName);
        return;
      }

      switch (field.cellValueType) {
        case CellValueType.DateTime:
          currentWhereRaw = searchQueryBuilder.getDateSqlQuery();
          break;
        case CellValueType.Number:
          currentWhereRaw = searchQueryBuilder.getNumberSqlQuery();
          break;
        case CellValueType.String:
          if (field.isStructuredCellValue) {
            currentWhereRaw = searchQueryBuilder.getJsonSqlQuery();
          } else {
            currentWhereRaw = searchQueryBuilder.getTextSqlQuery();
          }
          break;
      }

      joinWhereSql(index, currentWhereRaw, field.dbFieldName);
    });

    // as sub query
    originQueryBuilder.as('searchCountSubQuery');

    return originQueryBuilder;
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
