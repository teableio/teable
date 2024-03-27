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
    search?: string[]
  ) {
    if (!search || !search[1] || !fieldMap) {
      return originQueryBuilder;
    }
    const field = fieldMap?.[search[0]];
    const searchValue = search[1];
    if (field.cellValueType === CellValueType.Boolean) {
      return originQueryBuilder;
    }

    const searchQueryBuilder = new SearchQuery(originQueryBuilder, field, searchValue);

    if (field.isMultipleCellValue) {
      switch (field.cellValueType) {
        case CellValueType.DateTime:
          return searchQueryBuilder.multipleDate();
        case CellValueType.Number:
          return searchQueryBuilder.multipleNumber();
        case CellValueType.String:
          if (field.isStructuredCellValue) {
            return searchQueryBuilder.multipleJson();
          }
          return searchQueryBuilder.multipleText();
        default:
          return originQueryBuilder;
      }
    }

    switch (field.cellValueType) {
      case CellValueType.DateTime:
        return searchQueryBuilder.date();
      case CellValueType.Number:
        return searchQueryBuilder.number();
      case CellValueType.String:
        if (field.isStructuredCellValue) {
          return searchQueryBuilder.json();
        }
        return searchQueryBuilder.text();
      default:
        return originQueryBuilder;
    }
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
}
