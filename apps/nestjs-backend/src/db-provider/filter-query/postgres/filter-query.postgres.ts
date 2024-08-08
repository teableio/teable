import type { IFieldInstance } from '../../../features/field/model/factory';
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
  booleanFilter(field: IFieldInstance): CellValueFilterPostgres {
    const { isMultipleCellValue } = field;
    if (isMultipleCellValue) {
      return new MultipleBooleanCellValueFilterAdapter(field);
    }
    return new BooleanCellValueFilterAdapter(field);
  }

  numberFilter(field: IFieldInstance): CellValueFilterPostgres {
    const { isMultipleCellValue } = field;
    if (isMultipleCellValue) {
      return new MultipleNumberCellValueFilterAdapter(field);
    }
    return new NumberCellValueFilterAdapter(field);
  }

  dateTimeFilter(field: IFieldInstance): CellValueFilterPostgres {
    const { isMultipleCellValue } = field;
    if (isMultipleCellValue) {
      return new MultipleDatetimeCellValueFilterAdapter(field);
    }
    return new DatetimeCellValueFilterAdapter(field);
  }

  stringFilter(field: IFieldInstance): CellValueFilterPostgres {
    const { isMultipleCellValue } = field;
    if (isMultipleCellValue) {
      return new MultipleStringCellValueFilterAdapter(field);
    }
    return new StringCellValueFilterAdapter(field);
  }

  jsonFilter(field: IFieldInstance): CellValueFilterPostgres {
    const { isMultipleCellValue } = field;
    if (isMultipleCellValue) {
      return new MultipleJsonCellValueFilterAdapter(field);
    }
    return new JsonCellValueFilterAdapter(field);
  }
}
