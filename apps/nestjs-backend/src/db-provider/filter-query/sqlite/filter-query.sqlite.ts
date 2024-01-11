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
      return new MultipleBooleanCellValueFilterAdapter(this._table, field);
    }
    return new BooleanCellValueFilterAdapter(this._table, field);
  }

  numberFilter(field: IFieldInstance): CellValueFilterSqlite {
    const { isMultipleCellValue } = field;
    if (isMultipleCellValue) {
      return new MultipleNumberCellValueFilterAdapter(this._table, field);
    }
    return new NumberCellValueFilterAdapter(this._table, field);
  }

  dateTimeFilter(field: IFieldInstance): CellValueFilterSqlite {
    const { isMultipleCellValue } = field;
    if (isMultipleCellValue) {
      return new MultipleDatetimeCellValueFilterAdapter(this._table, field);
    }
    return new DatetimeCellValueFilterAdapter(this._table, field);
  }

  stringFilter(field: IFieldInstance): CellValueFilterSqlite {
    const { isMultipleCellValue } = field;
    if (isMultipleCellValue) {
      return new MultipleStringCellValueFilterAdapter(this._table, field);
    }
    return new StringCellValueFilterAdapter(this._table, field);
  }

  jsonFilter(field: IFieldInstance): AbstractCellValueFilter {
    const { isMultipleCellValue } = field;
    if (isMultipleCellValue) {
      return new MultipleJsonCellValueFilterAdapter(this._table, field);
    }
    return new JsonCellValueFilterAdapter(this._table, field);
  }
}
