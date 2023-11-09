import { AbstractFilterQuery } from '../filter-query.abstract';
import {
  BooleanCellValueFilterAdapter,
  DatetimeCellValueFilterAdapter,
  JsonCellValueFilterAdapter,
  MultipleBooleanCellValueFilterAdapter,
  MultipleDatetimeCellValueFilterAdapter,
  MultipleJsonCellValueFilterAdapter,
  MultipleNumberCellValueFilterAdapter,
  MultipleStringCellValueFilterAdapter,
  NumberCellValueFilterAdapter,
  StringCellValueFilterAdapter,
} from './cell-value-filter';
import type { CellValueFilterPostgres } from './cell-value-filter/cell-value-filter.postgres';

export class FilterQueryPostgres extends AbstractFilterQuery {
  booleanFilter(isMultipleCellValue?: boolean): CellValueFilterPostgres {
    if (isMultipleCellValue) {
      return new MultipleBooleanCellValueFilterAdapter(
        this.originQueryBuilder,
        this.fields,
        this.filter
      );
    }
    return new BooleanCellValueFilterAdapter(this.originQueryBuilder, this.fields, this.filter);
  }

  numberFilter(isMultipleCellValue?: boolean): CellValueFilterPostgres {
    if (isMultipleCellValue) {
      return new MultipleNumberCellValueFilterAdapter(
        this.originQueryBuilder,
        this.fields,
        this.filter
      );
    }
    return new NumberCellValueFilterAdapter(this.originQueryBuilder, this.fields, this.filter);
  }

  dateTimeFilter(isMultipleCellValue?: boolean): CellValueFilterPostgres {
    if (isMultipleCellValue) {
      return new MultipleDatetimeCellValueFilterAdapter(
        this.originQueryBuilder,
        this.fields,
        this.filter
      );
    }
    return new DatetimeCellValueFilterAdapter(this.originQueryBuilder, this.fields, this.filter);
  }

  stringFilter(isMultipleCellValue?: boolean): CellValueFilterPostgres {
    if (isMultipleCellValue) {
      return new MultipleStringCellValueFilterAdapter(
        this.originQueryBuilder,
        this.fields,
        this.filter
      );
    }
    return new StringCellValueFilterAdapter(this.originQueryBuilder, this.fields, this.filter);
  }

  jsonFilter(isMultipleCellValue?: boolean): CellValueFilterPostgres {
    if (isMultipleCellValue) {
      return new MultipleJsonCellValueFilterAdapter(
        this.originQueryBuilder,
        this.fields,
        this.filter
      );
    }
    return new JsonCellValueFilterAdapter(this.originQueryBuilder, this.fields, this.filter);
  }
}
