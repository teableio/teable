import type { IFieldInstance } from '../../../features/field/model/factory';
import { AbstractSortQuery } from '../sort-query.abstract';
import { MultipleDateTimeSortAdapter } from './multiple-value/multiple-datetime-sort.adapter';
import { MultipleJsonSortAdapter } from './multiple-value/multiple-json-sort.adapter';
import { MultipleNumberSortAdapter } from './multiple-value/multiple-number-sort.adapter';
import { DateSortAdapter } from './single-value/date-sort.adapter';
import { JsonSortAdapter } from './single-value/json-sort.adapter';
import { StringSortAdapter } from './single-value/string-sort.adapter';
import { SortFunctionSqlite } from './sort-query.function';

export class SortQuerySqlite extends AbstractSortQuery {
  booleanSort(field: IFieldInstance): SortFunctionSqlite {
    return new SortFunctionSqlite(this.knex, field);
  }

  numberSort(field: IFieldInstance): SortFunctionSqlite {
    const { isMultipleCellValue } = field;
    if (isMultipleCellValue) {
      return new MultipleNumberSortAdapter(this.knex, field);
    }
    return new SortFunctionSqlite(this.knex, field);
  }

  dateTimeSort(field: IFieldInstance): SortFunctionSqlite {
    const { isMultipleCellValue } = field;
    if (isMultipleCellValue) {
      return new MultipleDateTimeSortAdapter(this.knex, field);
    }
    return new DateSortAdapter(this.knex, field);
  }

  stringSort(field: IFieldInstance): SortFunctionSqlite {
    const { isMultipleCellValue } = field;
    if (isMultipleCellValue) {
      return new SortFunctionSqlite(this.knex, field);
    }
    return new StringSortAdapter(this.knex, field);
  }
  jsonSort(field: IFieldInstance): SortFunctionSqlite {
    const { isMultipleCellValue } = field;
    if (isMultipleCellValue) {
      return new MultipleJsonSortAdapter(this.knex, field);
    }
    return new JsonSortAdapter(this.knex, field);
  }
}
