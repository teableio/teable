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
    let searchArr = search[1]?.split(',');
    const searchValue = search[0];

    if (searchArr[0] === 'all_fields') {
      searchArr = Object.values(fieldMap).map((f) => f.id);
    }

    searchArr.forEach((item) => {
      const field = fieldMap?.[item];

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
