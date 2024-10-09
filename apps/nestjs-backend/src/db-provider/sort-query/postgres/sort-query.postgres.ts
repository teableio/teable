import type { IFieldInstance } from '../../../features/field/model/factory';
import { AbstractSortQuery } from '../sort-query.abstract';
import { MultipleDateTimeSortAdapter } from './multiple-value/multiple-datetime-sort.adapter';
import { MultipleJsonSortAdapter } from './multiple-value/multiple-json-sort.adapter';
import { MultipleNumberSortAdapter } from './multiple-value/multiple-number-sort.adapter';
import { DateSortAdapter } from './single-value/date-sort.adapter';
import { JsonSortAdapter } from './single-value/json-sort.adapter';
import { StringSortAdapter } from './single-value/string-sort.adapter';
import { SortFunctionPostgres } from './sort-query.function';

export class SortQueryPostgres extends AbstractSortQuery {
  booleanSort(field: IFieldInstance): SortFunctionPostgres {
    return new SortFunctionPostgres(this.knex, field);
  }

  numberSort(field: IFieldInstance): SortFunctionPostgres {
    const { isMultipleCellValue } = field;
    if (isMultipleCellValue) {
      return new MultipleNumberSortAdapter(this.knex, field);
    }
    return new SortFunctionPostgres(this.knex, field);
  }

  dateTimeSort(field: IFieldInstance): SortFunctionPostgres {
    const { isMultipleCellValue } = field;
    if (isMultipleCellValue) {
      return new MultipleDateTimeSortAdapter(this.knex, field);
    }
    return new DateSortAdapter(this.knex, field);
  }

  stringSort(field: IFieldInstance): SortFunctionPostgres {
    const { isMultipleCellValue } = field;
    if (isMultipleCellValue) {
      return new SortFunctionPostgres(this.knex, field);
    }
    return new StringSortAdapter(this.knex, field);
  }

  jsonSort(field: IFieldInstance): SortFunctionPostgres {
    const { isMultipleCellValue } = field;
    if (isMultipleCellValue) {
      return new MultipleJsonSortAdapter(this.knex, field);
    }
    return new JsonSortAdapter(this.knex, field);
  }
}
