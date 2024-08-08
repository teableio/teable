import type { IFieldInstance } from '../../../features/field/model/factory';
import type { AbstractCellValueFilter } from '../cell-value-filter.abstract';
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
import type { CellValueFilterSqlite } from './cell-value-filter/cell-value-filter.sqlite';

export class FilterQuerySqlite extends AbstractFilterQuery {
  booleanFilter(field: IFieldInstance): CellValueFilterSqlite {
    const { isMultipleCellValue } = field;
    if (isMultipleCellValue) {
      return new MultipleBooleanCellValueFilterAdapter(field);
    }
    return new BooleanCellValueFilterAdapter(field);
  }

  numberFilter(field: IFieldInstance): CellValueFilterSqlite {
    const { isMultipleCellValue } = field;
    if (isMultipleCellValue) {
      return new MultipleNumberCellValueFilterAdapter(field);
    }
    return new NumberCellValueFilterAdapter(field);
  }

  dateTimeFilter(field: IFieldInstance): CellValueFilterSqlite {
    const { isMultipleCellValue } = field;
    if (isMultipleCellValue) {
      return new MultipleDatetimeCellValueFilterAdapter(field);
    }
    return new DatetimeCellValueFilterAdapter(field);
  }

  stringFilter(field: IFieldInstance): CellValueFilterSqlite {
    const { isMultipleCellValue } = field;
    if (isMultipleCellValue) {
      return new MultipleStringCellValueFilterAdapter(field);
    }
    return new StringCellValueFilterAdapter(field);
  }

  jsonFilter(field: IFieldInstance): AbstractCellValueFilter {
    const { isMultipleCellValue } = field;
    if (isMultipleCellValue) {
      return new MultipleJsonCellValueFilterAdapter(field);
    }
    return new JsonCellValueFilterAdapter(field);
  }
}
